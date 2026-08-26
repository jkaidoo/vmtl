<?php

namespace App\Http\Controllers\Api;

use App\Enums\ApprovalAction;
use App\Enums\RequestStatus;
use App\Enums\RoleType;
use App\Http\Controllers\Controller;
use App\Http\Requests\ApproveRequestRequest;
use App\Http\Requests\AssignVehicleRequest;
use App\Http\Requests\RejectRequestRequest;
use App\Http\Requests\StoreVehicleRequestRequest;
use App\Http\Requests\UpdateVehicleRequestRequest;
use App\Http\Resources\TripResource;
use App\Http\Resources\VehicleRequestResource;
use App\Models\RequestApproval;
use App\Models\User;
use App\Models\VehicleRequest;
use App\Notifications\NewRequestNotification;
use App\Notifications\RequestApprovedNotification;
use App\Notifications\RequestChangesNotification;
use App\Notifications\RequestRejectedNotification;
use App\Services\AssignmentService;
use App\Services\AvailabilityService;
use App\Support\AuditLogger;
use App\Support\SequenceNumber;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Notification;

class VehicleRequestController extends Controller
{
    public function __construct(
        private readonly AvailabilityService $availability,
        private readonly AssignmentService $assignment,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', VehicleRequest::class);
        $user = $request->user();

        $query = VehicleRequest::with(['requester.role', 'department', 'latestApproval.approver', 'trip.vehicle', 'trip.driver']);

        // Without the "view all" capability, users only see their own requests.
        if (! $user->hasCapability(\App\Support\Capabilities::REQUESTS_VIEW_ALL)) {
            $query->where('requester_id', $user->id);
        }

        $query->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('department_id'), fn ($q) => $q->where('department_id', $request->integer('department_id')))
            ->when($request->filled('requester_id'), fn ($q) => $q->where('requester_id', $request->integer('requester_id')))
            ->when($request->filled('date_from'), fn ($q) => $q->whereDate('travel_date', '>=', $request->date('date_from')))
            ->when($request->filled('date_to'), fn ($q) => $q->whereDate('travel_date', '<=', $request->date('date_to')))
            ->when($request->filled('search'), function ($q) use ($request) {
                $s = $request->string('search');
                $q->where(fn ($qq) => $qq->where('request_number', 'like', "%{$s}%")
                    ->orWhere('destination', 'like', "%{$s}%")
                    ->orWhere('purpose', 'like', "%{$s}%"));
            });

        $sort = $request->string('sort', 'created_at')->toString();
        $direction = $request->string('direction', 'desc')->toString() === 'asc' ? 'asc' : 'desc';
        $allowedSorts = ['created_at', 'travel_date', 'status', 'request_number'];
        $query->orderBy(in_array($sort, $allowedSorts, true) ? $sort : 'created_at', $direction);

        return VehicleRequestResource::collection($query->paginate($request->integer('per_page', 15)));
    }

    public function store(StoreVehicleRequestRequest $request): JsonResponse
    {
        $this->authorize('create', VehicleRequest::class);
        $user = $request->user();

        // Reject windows that are already fully booked — no vehicle (of the
        // required capacity) or no driver is free for the requested window.
        $start = $request->date('requested_start_time');
        $end = $request->date('expected_end_time');
        $passengers = $request->integer('passenger_count', 1);

        if ($this->availability->availableVehicles($start, $end, $passengers)->isEmpty()) {
            throw new \App\Exceptions\BusinessRuleException('This time window is fully booked — no suitable vehicle is free then. Please choose another window.');
        }
        if ($this->availability->availableDrivers($start, $end)->isEmpty()) {
            throw new \App\Exceptions\BusinessRuleException('This time window is fully booked — no driver is free then. Please choose another window.');
        }

        $vehicleRequest = VehicleRequest::create([
            ...$request->validated(),
            'request_number' => SequenceNumber::next(VehicleRequest::class, 'request_number', 'REQ'),
            'requester_id' => $user->id,
            'department_id' => $request->input('department_id', $user->department_id),
            'status' => RequestStatus::PENDING,
        ]);

        AuditLogger::log(
            'request.created',
            "{$user->name} submitted request {$vehicleRequest->request_number}",
            $vehicleRequest,
        );

        // Notify approvers + administrators.
        $approvers = User::whereHas('role', fn ($q) => $q->whereIn('slug', [RoleType::APPROVER->value, RoleType::ADMINISTRATOR->value]))
            ->where('active', true)->get();
        Notification::send($approvers, new NewRequestNotification($vehicleRequest));

        return (new VehicleRequestResource($vehicleRequest->load(['requester', 'department'])))
            ->response()->setStatusCode(201);
    }

    /**
     * A goodwill request raised by a driver/transport officer. Needs an
     * explanation and must not conflict with existing bookings (spec).
     */
    public function storeGoodwill(\App\Http\Requests\StoreGoodwillRequest $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user->hasCapability(\App\Support\Capabilities::REQUESTS_CREATE_GOODWILL), 403, 'You may not raise goodwill requests.');

        $start = $request->date('requested_start_time');
        $end = $request->date('expected_end_time');

        // Conflict check: at least one suitable vehicle must be free for the window.
        $available = $this->availability->availableVehicles($start, $end, $request->integer('passenger_count', 1));
        if ($available->isEmpty()) {
            throw new \App\Exceptions\BusinessRuleException('This time window conflicts with existing bookings — no vehicle is free then.');
        }

        $vehicleRequest = VehicleRequest::create([
            'request_number' => SequenceNumber::next(VehicleRequest::class, 'request_number', 'REQ'),
            'requester_id' => $user->id,
            // Goodwill trips are not tied to a specific department.
            'department_id' => null,
            'travel_date' => $request->date('travel_date'),
            'requested_start_time' => $start,
            'expected_end_time' => $end,
            'destination' => $request->string('destination'),
            'purpose' => 'Goodwill: '.$request->string('goodwill_reason'),
            'passenger_count' => $request->integer('passenger_count'),
            'contact_number' => $request->input('contact_number'),
            'is_goodwill' => true,
            'goodwill_reason' => $request->string('goodwill_reason'),
            'status' => RequestStatus::PENDING,
        ]);

        AuditLogger::log('request.goodwill_created', "{$user->name} raised goodwill request {$vehicleRequest->request_number}", $vehicleRequest);

        $approvers = User::whereHas('role', fn ($q) => $q->whereIn('slug', [RoleType::APPROVER->value, RoleType::ADMINISTRATOR->value]))
            ->where('active', true)->get();
        Notification::send($approvers, new NewRequestNotification($vehicleRequest));

        return (new VehicleRequestResource($vehicleRequest->load(['requester', 'department'])))->response()->setStatusCode(201);
    }

    /**
     * An external travel request — a vehicle requested by another arm of the
     * university for an extended trip (often over weekends). Captures the
     * requesting unit, expected duration, and the odometer at hand-over. It then
     * flows through the normal approval + assignment lifecycle.
     */
    public function storeExternal(\App\Http\Requests\StoreExternalTravelRequest $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user->hasCapability(\App\Support\Capabilities::REQUESTS_CREATE_EXTERNAL), 403, 'You may not log external travel requests.');

        $vehicleRequest = VehicleRequest::create([
            'request_number' => SequenceNumber::next(VehicleRequest::class, 'request_number', 'REQ'),
            'requester_id' => $user->id,
            'department_id' => $request->input('department_id', $user->department_id),
            'travel_date' => $request->date('travel_date'),
            'requested_start_time' => $request->date('requested_start_time'),
            'expected_end_time' => $request->date('expected_end_time'),
            'destination' => $request->string('destination'),
            'purpose' => $request->string('purpose'),
            'passenger_count' => $request->integer('passenger_count'),
            'contact_number' => $request->input('contact_number'),
            'remarks' => $request->input('remarks'),
            'is_external' => true,
            'external_org' => $request->string('external_org'),
            'expected_duration_days' => $request->integer('expected_duration_days'),
            'start_odometer' => $request->integer('start_odometer'),
            'status' => RequestStatus::PENDING,
        ]);

        AuditLogger::log(
            'request.external_created',
            "{$user->name} logged external travel request {$vehicleRequest->request_number} for {$vehicleRequest->external_org}",
            $vehicleRequest,
        );

        $approvers = User::whereHas('role', fn ($q) => $q->whereIn('slug', [RoleType::APPROVER->value, RoleType::ADMINISTRATOR->value]))
            ->where('active', true)->get();
        Notification::send($approvers, new NewRequestNotification($vehicleRequest));

        return (new VehicleRequestResource($vehicleRequest->load(['requester', 'department'])))->response()->setStatusCode(201);
    }

    public function show(VehicleRequest $vehicleRequest): VehicleRequestResource
    {
        $this->authorize('view', $vehicleRequest);

        return new VehicleRequestResource(
            $vehicleRequest->load([
                'requester.role', 'requester.department', 'department',
                'approvals.approver', 'trip.vehicle', 'trip.driver', 'trip.startedBy', 'trip.endedBy',
                'trip.stops.requestedBy', 'trip.stops.decidedBy',
            ])
        );
    }

    public function update(UpdateVehicleRequestRequest $request, VehicleRequest $vehicleRequest): VehicleRequestResource
    {
        $this->authorize('update', $vehicleRequest);

        $data = $request->validated();

        // Editing a request that was sent back for changes resubmits it for review.
        $resubmitting = $vehicleRequest->status === RequestStatus::CHANGES_REQUESTED;
        $windowChanged = $request->filled('requested_start_time') || $request->filled('expected_end_time') || $request->filled('passenger_count');

        // Guard the (possibly new) window so an edit/resubmit can't land on a fully-booked slot.
        if ($resubmitting || $windowChanged) {
            $start = $request->filled('requested_start_time') ? $request->date('requested_start_time') : $vehicleRequest->requested_start_time;
            $end = $request->filled('expected_end_time') ? $request->date('expected_end_time') : $vehicleRequest->expected_end_time;
            $passengers = (int) ($data['passenger_count'] ?? $vehicleRequest->passenger_count);

            if ($this->availability->availableVehicles($start, $end, $passengers)->isEmpty()) {
                throw new \App\Exceptions\BusinessRuleException('This time window is fully booked — no suitable vehicle is free then. Please choose another window.');
            }
            if ($this->availability->availableDrivers($start, $end)->isEmpty()) {
                throw new \App\Exceptions\BusinessRuleException('This time window is fully booked — no driver is free then. Please choose another window.');
            }
        }

        if ($resubmitting) {
            $data['status'] = RequestStatus::PENDING;
        }

        $old = $vehicleRequest->only(array_keys($request->validated()));
        $vehicleRequest->update($data);

        AuditLogger::log('request.updated', "Request {$vehicleRequest->request_number} was updated", $vehicleRequest, $old, $request->validated());

        if ($resubmitting) {
            AuditLogger::log('request.resubmitted', "{$request->user()->name} resubmitted {$vehicleRequest->request_number} after changes", $vehicleRequest);
            $approvers = User::whereHas('role', fn ($q) => $q->whereIn('slug', [RoleType::APPROVER->value, RoleType::ADMINISTRATOR->value]))
                ->where('active', true)->get();
            Notification::send($approvers, new NewRequestNotification($vehicleRequest));
        }

        return new VehicleRequestResource($vehicleRequest->fresh(['requester', 'department', 'approvals.approver']));
    }

    /**
     * Send a pending/approved request back to the requester for changes, with an
     * explanation (e.g. "change the booking time"). The requester then edits and
     * resubmits it. Available to approvers and transport officers.
     */
    public function requestChanges(\App\Http\Requests\RequestChangesRequest $request, VehicleRequest $vehicleRequest): VehicleRequestResource
    {
        $this->authorize('requestChanges', $vehicleRequest);
        $user = $request->user();

        $vehicleRequest->update(['status' => RequestStatus::CHANGES_REQUESTED]);

        RequestApproval::create([
            'vehicle_request_id' => $vehicleRequest->id,
            'approver_id' => $user->id,
            'action' => ApprovalAction::CHANGES_REQUESTED,
            'comment' => $request->input('reason'),
            'approved_at' => now(),
        ]);

        AuditLogger::log('request.changes_requested', "{$user->name} requested changes on {$vehicleRequest->request_number}", $vehicleRequest, null, ['reason' => $request->input('reason')]);

        $vehicleRequest->requester?->notify(new RequestChangesNotification($vehicleRequest, $request->input('reason')));

        return new VehicleRequestResource($vehicleRequest->fresh(['requester', 'department', 'approvals.approver']));
    }

    public function cancel(Request $request, VehicleRequest $vehicleRequest): VehicleRequestResource
    {
        $this->authorize('cancel', $vehicleRequest);

        $vehicleRequest->update(['status' => RequestStatus::CANCELLED]);

        AuditLogger::log('request.cancelled', "Request {$vehicleRequest->request_number} was cancelled", $vehicleRequest);

        return new VehicleRequestResource($vehicleRequest->fresh(['requester', 'department']));
    }

    public function approve(ApproveRequestRequest $request, VehicleRequest $vehicleRequest): VehicleRequestResource
    {
        $this->authorize('approve', $vehicleRequest);
        $user = $request->user();

        $vehicleRequest->update(['status' => RequestStatus::APPROVED]);

        RequestApproval::create([
            'vehicle_request_id' => $vehicleRequest->id,
            'approver_id' => $user->id,
            'action' => ApprovalAction::APPROVED,
            'comment' => $request->input('comment'),
            'approved_at' => now(),
        ]);

        AuditLogger::log('request.approved', "{$user->name} approved request {$vehicleRequest->request_number}", $vehicleRequest);

        $vehicleRequest->requester?->notify(new RequestApprovedNotification($vehicleRequest, $request->input('comment')));

        return new VehicleRequestResource($vehicleRequest->fresh(['requester', 'department', 'approvals.approver']));
    }

    public function reject(RejectRequestRequest $request, VehicleRequest $vehicleRequest): VehicleRequestResource
    {
        $this->authorize('approve', $vehicleRequest);
        $user = $request->user();

        $vehicleRequest->update(['status' => RequestStatus::REJECTED]);

        RequestApproval::create([
            'vehicle_request_id' => $vehicleRequest->id,
            'approver_id' => $user->id,
            'action' => ApprovalAction::REJECTED,
            'comment' => $request->input('reason'),
            'approved_at' => now(),
        ]);

        AuditLogger::log('request.rejected', "{$user->name} rejected request {$vehicleRequest->request_number}", $vehicleRequest, null, ['reason' => $request->input('reason')]);

        $vehicleRequest->requester?->notify(new RequestRejectedNotification($vehicleRequest, $request->input('reason')));

        return new VehicleRequestResource($vehicleRequest->fresh(['requester', 'department', 'approvals.approver']));
    }

    /** Options for the assignment screen: vehicles/drivers free for this request's window. */
    public function assignmentOptions(VehicleRequest $vehicleRequest): JsonResponse
    {
        $this->authorize('assign', $vehicleRequest);

        $start = $vehicleRequest->requested_start_time;
        $end = $vehicleRequest->expected_end_time;

        return response()->json([
            'vehicles' => \App\Http\Resources\VehicleResource::collection(
                $this->availability->availableVehicles($start, $end, $vehicleRequest->passenger_count)
            ),
            'drivers' => \App\Http\Resources\DriverResource::collection(
                $this->availability->availableDrivers($start, $end)
            ),
        ]);
    }

    public function assign(AssignVehicleRequest $request, VehicleRequest $vehicleRequest): JsonResponse
    {
        $this->authorize('assign', $vehicleRequest);

        $trip = $this->assignment->assign(
            $vehicleRequest,
            $request->integer('vehicle_id'),
            $request->integer('driver_id'),
            $request->user(),
            $request->filled('scheduled_start') ? $request->date('scheduled_start') : null,
            $request->filled('scheduled_end') ? $request->date('scheduled_end') : null,
        );

        return (new TripResource($trip))->response()->setStatusCode(201);
    }
}

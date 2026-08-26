<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\CorrectOdometerRequest;
use App\Http\Requests\EndTripRequest;
use App\Http\Requests\MarkNoShowRequest;
use App\Http\Requests\StartTripRequest;
use App\Enums\TripStatus;
use App\Http\Resources\TripResource;
use App\Models\Trip;
use App\Models\TripStop;
use App\Notifications\GenericNotification;
use App\Services\TripService;
use App\Support\AuditLogger;
use App\Support\Capabilities;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class TripController extends Controller
{
    public function __construct(private readonly TripService $trips) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Trip::class);
        $user = $request->user();

        $query = Trip::with(['vehicle', 'driver', 'vehicleRequest.requester', 'vehicleRequest.department']);

        // Without operate/view-all capability, users only see trips tied to their
        // own requests, or (for drivers) trips assigned to them.
        if (! $user->hasCapability(\App\Support\Capabilities::TRIPS_OPERATE)
            && ! $user->hasCapability(\App\Support\Capabilities::REQUESTS_VIEW_ALL)) {
            $query->where(function ($q) use ($user) {
                $q->whereHas('vehicleRequest', fn ($r) => $r->where('requester_id', $user->id))
                    ->orWhereHas('driver', fn ($d) => $d->where('user_id', $user->id));
            });
        }

        $query->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('vehicle_id'), fn ($q) => $q->where('vehicle_id', $request->integer('vehicle_id')))
            ->when($request->filled('driver_id'), fn ($q) => $q->where('driver_id', $request->integer('driver_id')))
            ->when($request->filled('date_from'), fn ($q) => $q->whereDate('scheduled_start', '>=', $request->date('date_from')))
            ->when($request->filled('date_to'), fn ($q) => $q->whereDate('scheduled_start', '<=', $request->date('date_to')))
            ->when($request->filled('search'), function ($q) use ($request) {
                $s = $request->string('search');
                $q->where('trip_number', 'like', "%{$s}%")
                    ->orWhereHas('vehicleRequest', fn ($r) => $r->where('destination', 'like', "%{$s}%"));
            });

        return TripResource::collection(
            $query->orderByDesc('scheduled_start')->paginate($request->integer('per_page', 15))
        );
    }

    public function show(Trip $trip): TripResource
    {
        $this->authorize('view', $trip);

        return new TripResource($trip->load([
            'vehicle', 'driver', 'vehicleRequest.requester', 'vehicleRequest.department',
            'startedBy', 'endedBy', 'assignedBy', 'stops.requestedBy', 'stops.decidedBy',
        ]));
    }

    public function start(StartTripRequest $request, Trip $trip): TripResource
    {
        $this->authorize('operate', $trip);

        $trip = $this->trips->start(
            $trip,
            $request->user(),
            $request->filled('starting_odometer') ? $request->integer('starting_odometer') : null,
            $request->input('notes'),
        );

        return new TripResource($trip);
    }

    public function complete(EndTripRequest $request, Trip $trip): TripResource
    {
        $this->authorize('operate', $trip);

        $trip = $this->trips->end(
            $trip,
            $request->user(),
            $request->integer('ending_odometer'),
            $request->input('notes'),
        );

        return new TripResource($trip);
    }

    public function noShow(MarkNoShowRequest $request, Trip $trip): TripResource
    {
        $this->authorize('operate', $trip);

        $trip = $this->trips->markNoShow($trip, $request->user(), $request->input('reason'));

        return new TripResource($trip);
    }

    public function correctOdometer(CorrectOdometerRequest $request, Trip $trip): TripResource
    {
        $this->authorize('correct', $trip);

        $trip = $this->trips->correctOdometer(
            $trip,
            $request->user(),
            $request->filled('starting_odometer') ? $request->integer('starting_odometer') : null,
            $request->filled('ending_odometer') ? $request->integer('ending_odometer') : null,
            $request->input('reason'),
        );

        return new TripResource($trip);
    }

    /**
     * The requester adds an extra destination during an active trip. It stays
     * pending until the driver accepts it.
     */
    public function addStop(Request $request, Trip $trip): JsonResponse
    {
        $this->authorize('view', $trip); // requester/driver/operator can view

        $user = $request->user();
        $isRequester = $trip->vehicleRequest?->requester_id === $user->id;
        abort_unless($isRequester || $user->hasCapability(Capabilities::TRIPS_OPERATE), 403, 'Only the requester may add a destination.');
        abort_unless($trip->status === TripStatus::IN_PROGRESS, 422, 'Destinations can only be added while the trip is in progress.');

        $data = $request->validate([
            'destination' => ['required', 'string', 'max:255'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        $stop = TripStop::create([
            'trip_id' => $trip->id,
            'destination' => $data['destination'],
            'note' => $data['note'] ?? null,
            'status' => 'pending',
            'requested_by' => $user->id,
        ]);

        AuditLogger::log('trip.stop_requested', "{$user->name} requested an added destination ({$stop->destination}) on trip {$trip->trip_number}", $trip);

        // Notify the assigned driver so they can accept it.
        $trip->driver?->user?->notify(new GenericNotification(
            'trip.stop_requested',
            'Added destination requested',
            "{$user->name} added \"{$stop->destination}\" to trip {$trip->trip_number}. Please accept or decline.",
            "/trips/{$trip->id}",
            ['trip_id' => $trip->id],
        ));

        return (new TripResource($trip->fresh(['vehicle', 'driver', 'vehicleRequest', 'stops.requestedBy'])))->response()->setStatusCode(201);
    }

    /** The driver (or an operator) accepts or declines a pending added destination. */
    public function decideStop(Request $request, Trip $trip, TripStop $stop): TripResource
    {
        $this->authorize('operate', $trip);
        abort_unless($stop->trip_id === $trip->id, 404);
        abort_unless($stop->status === 'pending', 422, 'This destination has already been decided.');

        $accept = $request->boolean('accept');
        $user = $request->user();

        $stop->update([
            'status' => $accept ? 'accepted' : 'declined',
            'decided_by' => $user->id,
            'decided_at' => now(),
        ]);

        AuditLogger::log(
            $accept ? 'trip.stop_accepted' : 'trip.stop_declined',
            "{$user->name} ".($accept ? 'accepted' : 'declined')." added destination ({$stop->destination}) on trip {$trip->trip_number}",
            $trip,
        );

        // Let the requester know the outcome.
        $trip->vehicleRequest?->requester?->notify(new GenericNotification(
            $accept ? 'trip.stop_accepted' : 'trip.stop_declined',
            $accept ? 'Added destination accepted' : 'Added destination declined',
            "The driver ".($accept ? 'accepted' : 'declined')." \"{$stop->destination}\" on trip {$trip->trip_number}.",
            "/requests/{$trip->vehicle_request_id}",
            ['vehicle_request_id' => $trip->vehicle_request_id],
        ));

        // If accepted, warn the next trip in line for this vehicle about a possible delay.
        if ($accept) {
            $this->notifyNextTripOfDelay($trip);
        }

        return new TripResource($trip->fresh(['vehicle', 'driver', 'vehicleRequest', 'stops.requestedBy', 'stops.decidedBy']));
    }

    /** Notify the next scheduled trip for this vehicle that it may be delayed. */
    private function notifyNextTripOfDelay(Trip $trip): void
    {
        $next = Trip::with(['vehicleRequest.requester', 'driver.user'])
            ->where('vehicle_id', $trip->vehicle_id)
            ->where('id', '!=', $trip->id)
            ->where('status', TripStatus::SCHEDULED->value)
            ->where('scheduled_start', '>=', $trip->scheduled_start)
            ->orderBy('scheduled_start')
            ->first();

        if (! $next) {
            return;
        }

        $message = "The vehicle {$trip->vehicle?->vehicle_number} on the earlier trip {$trip->trip_number} has an added destination and may run late, which could delay trip {$next->trip_number}.";

        foreach (array_filter([$next->vehicleRequest?->requester, $next->driver?->user]) as $recipient) {
            $recipient->notify(new GenericNotification(
                'trip.delay_warning',
                'Possible delay to your trip',
                $message,
                "/trips/{$next->id}",
                ['trip_id' => $next->id],
            ));
        }

        AuditLogger::log('trip.delay_notified', "Next trip {$next->trip_number} notified of a possible delay from {$trip->trip_number}", $next);
    }
}

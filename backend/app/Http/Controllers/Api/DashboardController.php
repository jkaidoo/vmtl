<?php

namespace App\Http\Controllers\Api;

use App\Enums\RequestStatus;
use App\Enums\TripStatus;
use App\Enums\VehicleStatus;
use App\Http\Controllers\Controller;
use App\Http\Resources\AuditLogResource;
use App\Http\Resources\TripResource;
use App\Http\Resources\VehicleRequestResource;
use App\Http\Resources\VehicleResource;
use App\Models\AuditLog;
use App\Models\Trip;
use App\Models\Vehicle;
use App\Models\VehicleRequest;
use App\Services\MaintenanceAlertService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    public function __construct(private readonly MaintenanceAlertService $alerts) {}

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        // Pure requesters (Staff) have no dashboard — they only use the Requests area.
        abort_if($user->isRequesterOnly(), 403, 'The dashboard is not available for your role.');

        $today = today();
        $driverId = $user->isDriver() ? $user->driver?->id : null;

        $todaysTrips = Trip::with(['vehicle', 'driver', 'vehicleRequest'])
            ->whereDate('scheduled_start', $today)
            // Drivers only see their own trips on the schedule.
            ->when($driverId, fn ($q) => $q->where('driver_id', $driverId))
            ->orderBy('scheduled_start')
            ->get();

        $cards = [
            'pending_requests' => VehicleRequest::where('status', RequestStatus::PENDING->value)->count(),
            'todays_trips' => $todaysTrips->count(),
            'vehicles_available' => Vehicle::where('active', true)->where('status', VehicleStatus::AVAILABLE->value)->count(),
            'vehicles_on_trip' => Vehicle::where('status', VehicleStatus::ON_TRIP->value)->count(),
            'completed_trips_today' => $todaysTrips->where('status', TripStatus::COMPLETED)->count(),
            'total_distance_month' => (int) Trip::where('status', TripStatus::COMPLETED->value)
                ->whereMonth('actual_end', $today->month)
                ->whereYear('actual_end', $today->year)
                ->sum('distance'),
        ];

        $vehicleBoard = Vehicle::with(['activeTrip.driver', 'activeTrip.vehicleRequest'])
            ->where('active', true)
            ->orderBy('vehicle_number')
            ->get();

        $data = [
            'cards' => $cards,
            'todays_schedule' => TripResource::collection($todaysTrips),
            'vehicle_board' => VehicleResource::collection($vehicleBoard),
            'maintenance_alerts' => $this->alerts->all(),
        ];

        // Drivers get their own upcoming/active trips instead of approvals or requests.
        if ($driverId) {
            $data['my_trips'] = TripResource::collection(
                Trip::with(['vehicle', 'driver', 'vehicleRequest'])
                    ->where('driver_id', $driverId)
                    ->whereIn('status', [TripStatus::SCHEDULED->value, TripStatus::IN_PROGRESS->value])
                    ->orderBy('scheduled_start')
                    ->limit(10)->get()
            );

            return response()->json(['data' => $data]);
        }

        // Pending approvals shown to approvers/admins; staff see their recent requests instead.
        if ($user->managesFleet() || $user->isApprover()) {
            $data['pending_approvals'] = VehicleRequestResource::collection(
                VehicleRequest::with(['requester', 'department'])
                    ->where('status', RequestStatus::PENDING->value)
                    ->latest()->limit(8)->get()
            );
        } else {
            $data['my_recent_requests'] = VehicleRequestResource::collection(
                VehicleRequest::with(['department', 'trip'])
                    ->where('requester_id', $user->id)
                    ->latest()->limit(8)->get()
            );
        }

        // Recent activity feed (admins/transport see the audit log).
        if ($user->managesFleet()) {
            $data['recent_activity'] = AuditLogResource::collection(
                AuditLog::with('user')->latest('created_at')->limit(10)->get()
            );
        }

        return response()->json(['data' => $data]);
    }
}

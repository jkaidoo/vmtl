<?php

namespace App\Services;

use App\Enums\DriverStatus;
use App\Enums\RequestStatus;
use App\Enums\TripStatus;
use App\Enums\VehicleStatus;
use App\Exceptions\BusinessRuleException;
use App\Models\Driver;
use App\Models\Trip;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleRequest;
use App\Notifications\VehicleAssignedNotification;
use App\Support\AuditLogger;
use App\Support\SequenceNumber;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AssignmentService
{
    public function __construct(private readonly AvailabilityService $availability) {}

    /**
     * Assign a vehicle + driver to an approved request and create the trip.
     * Runs inside a transaction with pessimistic locks so two officers cannot
     * assign the same vehicle/driver to overlapping trips (spec §33).
     */
    public function assign(
        VehicleRequest $request,
        int $vehicleId,
        int $driverId,
        User $actor,
        ?Carbon $scheduledStart = null,
        ?Carbon $scheduledEnd = null,
    ): Trip {
        $start = $scheduledStart ?? $request->requested_start_time;
        $end = $scheduledEnd ?? $request->expected_end_time;

        return DB::transaction(function () use ($request, $vehicleId, $driverId, $actor, $start, $end) {
            // Re-read the request under lock and re-validate its state.
            $request = VehicleRequest::whereKey($request->id)->lockForUpdate()->firstOrFail();

            if ($request->status !== RequestStatus::APPROVED) {
                throw new BusinessRuleException('Only approved requests can be assigned a vehicle and driver.');
            }

            if ($request->trip()->exists()) {
                throw new BusinessRuleException('This request already has a trip assigned.');
            }

            /** @var Vehicle $vehicle */
            $vehicle = Vehicle::whereKey($vehicleId)->lockForUpdate()->firstOrFail();
            /** @var Driver $driver */
            $driver = Driver::whereKey($driverId)->lockForUpdate()->firstOrFail();

            if (! $vehicle->active || ! $vehicle->status->isAssignable()) {
                throw new BusinessRuleException("Vehicle {$vehicle->vehicle_number} is not available for assignment.");
            }

            if (! $driver->active || ! $driver->status->isAssignable()) {
                throw new BusinessRuleException("Driver {$driver->name} is not available for assignment.");
            }

            if ($vehicle->capacity < $request->passenger_count) {
                throw new BusinessRuleException(
                    "Vehicle capacity ({$vehicle->capacity}) is less than the requested passengers ({$request->passenger_count})."
                );
            }

            if ($this->availability->vehicleHasConflict($vehicle->id, $start, $end)) {
                throw new BusinessRuleException("Vehicle {$vehicle->vehicle_number} is already booked for an overlapping period.");
            }

            if ($this->availability->driverHasConflict($driver->id, $start, $end)) {
                throw new BusinessRuleException("Driver {$driver->name} is already booked for an overlapping period.");
            }

            $trip = Trip::create([
                'trip_number' => SequenceNumber::next(Trip::class, 'trip_number', 'TRIP'),
                'vehicle_request_id' => $request->id,
                'vehicle_id' => $vehicle->id,
                'driver_id' => $driver->id,
                'scheduled_start' => $start,
                'scheduled_end' => $end,
                'status' => TripStatus::SCHEDULED,
                'assigned_by' => $actor->id,
            ]);

            $request->update(['status' => RequestStatus::SCHEDULED]);
            $vehicle->update(['status' => VehicleStatus::SCHEDULED]);
            // Driver remains AVAILABLE until the trip actually starts, so they can
            // still be scheduled for non-overlapping trips.

            AuditLogger::log(
                'request.assigned',
                "{$actor->name} assigned {$vehicle->vehicle_number} + driver {$driver->name} to request {$request->request_number} (trip {$trip->trip_number})",
                $trip,
                null,
                ['vehicle_id' => $vehicle->id, 'driver_id' => $driver->id],
                $actor,
            );

            $request->requester?->notify(new VehicleAssignedNotification($trip));
            $driver->user?->notify(new VehicleAssignedNotification($trip));

            return $trip->load(['vehicle', 'driver', 'vehicleRequest']);
        });
    }
}

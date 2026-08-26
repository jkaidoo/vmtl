<?php

namespace App\Services;

use App\Enums\DriverStatus;
use App\Enums\RequestStatus;
use App\Enums\TripStatus;
use App\Enums\VehicleStatus;
use App\Exceptions\BusinessRuleException;
use App\Models\OdometerReading;
use App\Models\Trip;
use App\Models\User;
use App\Notifications\TripCompletedNotification;
use App\Support\AuditLogger;
use Illuminate\Support\Facades\DB;

class TripService
{
    /**
     * Start a scheduled trip. Records the actual start timestamp automatically
     * (the user never enters it) and the starting odometer.
     */
    public function start(Trip $trip, User $actor, ?int $startingOdometer = null, ?string $notes = null): Trip
    {
        return DB::transaction(function () use ($trip, $actor, $startingOdometer, $notes) {
            $trip = Trip::whereKey($trip->id)->lockForUpdate()->firstOrFail();

            if ($trip->status === TripStatus::COMPLETED) {
                throw new BusinessRuleException('This trip is already completed.');
            }

            if ($trip->status !== TripStatus::SCHEDULED) {
                throw new BusinessRuleException('Only scheduled trips can be started.');
            }

            $vehicle = $trip->vehicle()->lockForUpdate()->firstOrFail();
            $driver = $trip->driver()->lockForUpdate()->firstOrFail();

            $starting = $startingOdometer ?? $vehicle->current_odometer;

            if ($starting < $vehicle->current_odometer) {
                throw new BusinessRuleException(
                    "Starting odometer ({$starting}) cannot be lower than the vehicle's current reading ({$vehicle->current_odometer})."
                );
            }

            $trip->update([
                'status' => TripStatus::IN_PROGRESS,
                'actual_start' => now(),
                'starting_odometer' => $starting,
                'start_notes' => $notes,
                'started_by' => $actor->id,
            ]);

            $trip->vehicleRequest?->update(['status' => RequestStatus::IN_PROGRESS]);
            $vehicle->update(['status' => VehicleStatus::ON_TRIP, 'current_odometer' => $starting]);
            $driver->update(['status' => DriverStatus::ON_TRIP]);

            OdometerReading::create([
                'vehicle_id' => $vehicle->id,
                'trip_id' => $trip->id,
                'reading' => $starting,
                'source' => 'trip_start',
                'recorded_by' => $actor->id,
            ]);

            AuditLogger::log(
                'trip.started',
                "{$actor->name} started trip {$trip->trip_number} ({$vehicle->vehicle_number}) at odometer {$starting}",
                $trip,
                null,
                ['starting_odometer' => $starting],
                $actor,
            );

            return $trip->fresh(['vehicle', 'driver', 'vehicleRequest']);
        });
    }

    /**
     * End an in-progress trip. Records the actual end timestamp automatically,
     * validates the ending odometer, and computes distance + duration.
     */
    public function end(Trip $trip, User $actor, int $endingOdometer, ?string $notes = null): Trip
    {
        return DB::transaction(function () use ($trip, $actor, $endingOdometer, $notes) {
            $trip = Trip::whereKey($trip->id)->lockForUpdate()->firstOrFail();

            if ($trip->status === TripStatus::COMPLETED) {
                throw new BusinessRuleException('This trip is already completed.');
            }

            if ($trip->status !== TripStatus::IN_PROGRESS) {
                throw new BusinessRuleException('Only a trip that is in progress can be completed.');
            }

            $vehicle = $trip->vehicle()->lockForUpdate()->firstOrFail();
            $driver = $trip->driver()->lockForUpdate()->firstOrFail();

            if ($endingOdometer < $trip->starting_odometer) {
                throw new BusinessRuleException(
                    "Ending odometer ({$endingOdometer}) cannot be lower than the starting odometer ({$trip->starting_odometer})."
                );
            }

            $distance = $endingOdometer - $trip->starting_odometer;
            $duration = $trip->actual_start ? $trip->actual_start->diffInMinutes(now()) : null;

            $trip->update([
                'status' => TripStatus::COMPLETED,
                'actual_end' => now(),
                'ending_odometer' => $endingOdometer,
                'distance' => $distance,
                'duration_minutes' => $duration,
                'end_notes' => $notes,
                'ended_by' => $actor->id,
            ]);

            $trip->vehicleRequest?->update(['status' => RequestStatus::COMPLETED]);
            $vehicle->update(['status' => VehicleStatus::AVAILABLE, 'current_odometer' => $endingOdometer]);
            $driver->update(['status' => DriverStatus::AVAILABLE]);

            OdometerReading::create([
                'vehicle_id' => $vehicle->id,
                'trip_id' => $trip->id,
                'reading' => $endingOdometer,
                'source' => 'trip_end',
                'recorded_by' => $actor->id,
            ]);

            AuditLogger::log(
                'trip.completed',
                "{$actor->name} completed trip {$trip->trip_number} ({$vehicle->vehicle_number}); distance {$distance} km",
                $trip,
                null,
                ['ending_odometer' => $endingOdometer, 'distance' => $distance],
                $actor,
            );

            $trip->vehicleRequest?->requester?->notify(new TripCompletedNotification($trip));

            return $trip->fresh(['vehicle', 'driver', 'vehicleRequest']);
        });
    }

    /**
     * Mark a scheduled trip as a no-show: the vehicle/driver were assigned but
     * the trip never took place. Releases the vehicle and closes the request.
     */
    public function markNoShow(Trip $trip, User $actor, ?string $reason = null): Trip
    {
        return DB::transaction(function () use ($trip, $actor, $reason) {
            $trip = Trip::whereKey($trip->id)->lockForUpdate()->firstOrFail();

            if ($trip->status === TripStatus::COMPLETED) {
                throw new BusinessRuleException('A completed trip cannot be marked as a no-show.');
            }

            if ($trip->status !== TripStatus::SCHEDULED) {
                throw new BusinessRuleException('Only a scheduled trip can be marked as a no-show.');
            }

            $vehicle = $trip->vehicle()->lockForUpdate()->firstOrFail();
            $driver = $trip->driver()->lockForUpdate()->firstOrFail();

            $trip->update([
                'status' => TripStatus::NO_SHOW,
                'admin_remarks' => $reason,
                'ended_by' => $actor->id,
            ]);

            $trip->vehicleRequest?->update(['status' => RequestStatus::NO_SHOW]);

            // Release the reserved vehicle/driver (they never left).
            if ($vehicle->status === VehicleStatus::SCHEDULED) {
                $vehicle->update(['status' => VehicleStatus::AVAILABLE]);
            }
            if ($driver->status === DriverStatus::ON_TRIP) {
                $driver->update(['status' => DriverStatus::AVAILABLE]);
            }

            AuditLogger::log(
                'trip.no_show',
                "{$actor->name} marked trip {$trip->trip_number} as a no-show".($reason ? " ({$reason})" : ''),
                $trip,
                null,
                ['status' => TripStatus::NO_SHOW->value],
                $actor,
            );

            return $trip->fresh(['vehicle', 'driver', 'vehicleRequest']);
        });
    }

    /**
     * Administrative correction of a recorded odometer reading. Every correction
     * is written to the audit log (spec §15).
     */
    public function correctOdometer(Trip $trip, User $actor, ?int $starting, ?int $ending, ?string $reason = null): Trip
    {
        return DB::transaction(function () use ($trip, $actor, $starting, $ending, $reason) {
            $trip = Trip::whereKey($trip->id)->lockForUpdate()->firstOrFail();
            $vehicle = $trip->vehicle()->lockForUpdate()->firstOrFail();

            $old = ['starting_odometer' => $trip->starting_odometer, 'ending_odometer' => $trip->ending_odometer];

            $newStart = $starting ?? $trip->starting_odometer;
            $newEnd = $ending ?? $trip->ending_odometer;

            if ($newStart !== null && $newEnd !== null && $newEnd < $newStart) {
                throw new BusinessRuleException('Ending odometer cannot be lower than starting odometer.');
            }

            $trip->starting_odometer = $newStart;
            $trip->ending_odometer = $newEnd;
            if ($newStart !== null && $newEnd !== null) {
                $trip->distance = $newEnd - $newStart;
            }
            $trip->save();

            // Keep the vehicle's current reading consistent with the corrected end value.
            if ($newEnd !== null && $trip->status === TripStatus::COMPLETED && $newEnd > $vehicle->current_odometer) {
                $vehicle->update(['current_odometer' => $newEnd]);
            }

            OdometerReading::create([
                'vehicle_id' => $vehicle->id,
                'trip_id' => $trip->id,
                'reading' => $newEnd ?? $newStart ?? 0,
                'source' => 'correction',
                'recorded_by' => $actor->id,
                'note' => $reason,
            ]);

            AuditLogger::log(
                'trip.odometer_corrected',
                "{$actor->name} corrected odometer on trip {$trip->trip_number}".($reason ? " ({$reason})" : ''),
                $trip,
                $old,
                ['starting_odometer' => $newStart, 'ending_odometer' => $newEnd],
                $actor,
            );

            return $trip->fresh(['vehicle', 'driver', 'vehicleRequest']);
        });
    }
}

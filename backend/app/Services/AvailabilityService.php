<?php

namespace App\Services;

use App\Enums\DriverStatus;
use App\Enums\TripStatus;
use App\Enums\VehicleStatus;
use App\Models\Driver;
use App\Models\Trip;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

class AvailabilityService
{
    /** Trip statuses that occupy a vehicle/driver for scheduling purposes. */
    private const BLOCKING = [TripStatus::SCHEDULED, TripStatus::IN_PROGRESS];

    public function vehicleHasConflict(int $vehicleId, Carbon $start, Carbon $end, ?int $exceptTripId = null): bool
    {
        return $this->overlapQuery($start, $end, $exceptTripId)
            ->where('vehicle_id', $vehicleId)
            ->exists();
    }

    public function driverHasConflict(int $driverId, Carbon $start, Carbon $end, ?int $exceptTripId = null): bool
    {
        return $this->overlapQuery($start, $end, $exceptTripId)
            ->where('driver_id', $driverId)
            ->exists();
    }

    /** Overlap: existing.start < new.end AND existing.end > new.start. */
    private function overlapQuery(Carbon $start, Carbon $end, ?int $exceptTripId): Builder
    {
        return Trip::query()
            ->whereIn('status', array_map(fn ($s) => $s->value, self::BLOCKING))
            ->where('scheduled_start', '<', $end)
            ->where('scheduled_end', '>', $start)
            ->when($exceptTripId, fn (Builder $q) => $q->where('id', '!=', $exceptTripId));
    }

    /**
     * Vehicles that are active, in an assignable status, meet capacity, and have
     * no scheduling conflict in the requested window.
     */
    public function availableVehicles(Carbon $start, Carbon $end, int $minCapacity = 1): Collection
    {
        return Vehicle::query()
            ->where('active', true)
            ->whereIn('status', [VehicleStatus::AVAILABLE->value, VehicleStatus::SCHEDULED->value])
            ->where('capacity', '>=', $minCapacity)
            ->get()
            ->reject(fn (Vehicle $v) => $this->vehicleHasConflict($v->id, $start, $end))
            ->values();
    }

    public function availableDrivers(Carbon $start, Carbon $end): Collection
    {
        return Driver::query()
            ->where('active', true)
            ->where('status', DriverStatus::AVAILABLE->value)
            ->get()
            ->reject(fn (Driver $d) => $this->driverHasConflict($d->id, $start, $end))
            ->values();
    }
}

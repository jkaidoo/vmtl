<?php

namespace App\Services;

use App\Models\Trip;
use Illuminate\Database\Eloquent\Builder;

class TripQueryFilter
{
    /**
     * Apply the standard analytics/report filters to a Trip query.
     *
     * @param  array<string,mixed>  $filters
     */
    public static function apply(Builder $query, array $filters): Builder
    {
        // Columns are table-qualified so filters remain unambiguous when the
        // analytics queries join vehicle_requests (which also has a status column).
        $query->when($filters['date_from'] ?? null, fn (Builder $q, $v) => $q->whereDate('trips.scheduled_start', '>=', $v));
        $query->when($filters['date_to'] ?? null, fn (Builder $q, $v) => $q->whereDate('trips.scheduled_start', '<=', $v));
        $query->when($filters['vehicle_id'] ?? null, fn (Builder $q, $v) => $q->where('trips.vehicle_id', $v));
        $query->when($filters['driver_id'] ?? null, fn (Builder $q, $v) => $q->where('trips.driver_id', $v));
        $query->when($filters['status'] ?? null, fn (Builder $q, $v) => $q->where('trips.status', $v));

        $query->when($filters['department_id'] ?? null, fn (Builder $q, $v) => $q->whereHas('vehicleRequest', fn (Builder $r) => $r->where('department_id', $v)));
        $query->when($filters['requester_id'] ?? null, fn (Builder $q, $v) => $q->whereHas('vehicleRequest', fn (Builder $r) => $r->where('requester_id', $v)));
        $query->when($filters['destination'] ?? null, fn (Builder $q, $v) => $q->whereHas('vehicleRequest', fn (Builder $r) => $r->where('destination', 'like', "%{$v}%")));

        return $query;
    }

    /** @param array<string,mixed> $filters */
    public static function query(array $filters): Builder
    {
        return self::apply(Trip::query(), $filters);
    }
}

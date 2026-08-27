<?php

namespace App\Services;

use App\Enums\RequestStatus;
use App\Enums\TripStatus;
use App\Models\FuelLog;
use App\Models\Trip;
use App\Models\VehicleRequest;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

class AnalyticsService
{
    /**
     * Build the full analytics payload for the given filters (spec §18).
     *
     * @param  array<string,mixed>  $filters
     * @return array<string,mixed>
     */
    public function build(array $filters): array
    {
        return [
            'summary' => $this->summary($filters),
            'trips_by_vehicle' => $this->tripsByVehicle($filters),
            'trips_by_driver' => $this->tripsByDriver($filters),
            'trips_by_department' => $this->tripsByDepartment($filters),
            'trips_by_destination' => $this->tripsByDestination($filters),
            'monthly_utilisation' => $this->monthlyUtilisation($filters),
            'distance' => $this->distance($filters),
            'trip_duration' => $this->tripDuration($filters),
            'approval_statistics' => $this->approvalStatistics($filters),
            'peak_usage' => $this->peakUsage($filters),
            'fuel' => $this->fuel($filters),
        ];
    }

    /**
     * Base fuel-log query with the filters that map to a purchase (date window,
     * vehicle, driver). Department/destination don't apply to fuel purchases.
     *
     * @param array<string,mixed> $filters
     */
    private function fuelBase(array $filters): Builder
    {
        return FuelLog::query()
            ->when($filters['date_from'] ?? null, fn (Builder $q, $v) => $q->whereDate('purchase_date', '>=', $v))
            ->when($filters['date_to'] ?? null, fn (Builder $q, $v) => $q->whereDate('purchase_date', '<=', $v))
            ->when($filters['vehicle_id'] ?? null, fn (Builder $q, $v) => $q->where('vehicle_id', $v))
            ->when($filters['driver_id'] ?? null, fn (Builder $q, $v) => $q->where('driver_id', $v));
    }

    /**
     * Fuel spend and economy. Economy (km/L) and cost-per-km are derived only
     * from fills that carry a previous-purchase odometer, since distance-per-tank
     * is undefined for a vehicle's first recorded fill.
     *
     * @param array<string,mixed> $filters @return array<string,mixed>
     */
    private function fuel(array $filters): array
    {
        $base = $this->fuelBase($filters);

        $totalCost = (float) (clone $base)->sum('total_cost');
        $totalLitres = (float) (clone $base)->sum('litres');
        $fills = (clone $base)->count();

        $measured = (clone $base)->whereNotNull('previous_odometer');
        $measuredDistance = (int) (clone $measured)->sum(DB::raw('odometer - previous_odometer'));
        $measuredLitres = (float) (clone $measured)->sum('litres');
        $measuredCost = (float) (clone $measured)->sum('total_cost');

        $byVehicle = (clone $base)
            ->select(
                'vehicle_id',
                DB::raw('sum(litres) as litres'),
                DB::raw('sum(total_cost) as cost'),
                DB::raw('sum(case when previous_odometer is not null then odometer - previous_odometer else 0 end) as distance'),
                DB::raw('sum(case when previous_odometer is not null then litres else 0 end) as measured_litres'),
            )
            ->with('vehicle:id,vehicle_number')
            ->groupBy('vehicle_id')
            ->get()
            ->map(fn (FuelLog $r) => [
                'label' => $r->vehicle?->vehicle_number ?? "#{$r->vehicle_id}",
                'litres' => round((float) $r->litres, 2),
                'cost' => round((float) $r->cost, 2),
                'distance' => (int) $r->distance,
                'km_per_litre' => (float) $r->measured_litres > 0 ? round($r->distance / $r->measured_litres, 3) : null,
            ])->all();

        $byMonth = (clone $base)
            ->select(
                DB::raw("DATE_FORMAT(purchase_date, '%Y-%m') as period"),
                DB::raw('sum(total_cost) as cost'),
                DB::raw('sum(litres) as litres'),
            )
            ->groupBy('period')
            ->orderBy('period')
            ->get()
            ->map(fn ($r) => ['period' => $r->period, 'cost' => round((float) $r->cost, 2), 'litres' => round((float) $r->litres, 2)])->all();

        return [
            'summary' => [
                'total_cost' => round($totalCost, 2),
                'total_litres' => round($totalLitres, 2),
                'fills' => $fills,
                'avg_price_per_litre' => $totalLitres > 0 ? round($totalCost / $totalLitres, 3) : null,
                'km_per_litre' => $measuredLitres > 0 ? round($measuredDistance / $measuredLitres, 3) : null,
                'cost_per_km' => $measuredDistance > 0 ? round($measuredCost / $measuredDistance, 3) : null,
                'measured_distance' => $measuredDistance,
            ],
            'by_vehicle' => $byVehicle,
            'by_month' => $byMonth,
        ];
    }

    /** @param array<string,mixed> $filters */
    private function completed(array $filters)
    {
        return TripQueryFilter::query($filters)->where('trips.status', TripStatus::COMPLETED->value);
    }

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    private function summary(array $filters): array
    {
        $all = TripQueryFilter::query($filters);

        return [
            'total_trips' => (clone $all)->count(),
            'completed_trips' => (clone $all)->where('status', TripStatus::COMPLETED->value)->count(),
            'total_distance' => (int) $this->completed($filters)->sum('distance'),
            'avg_distance' => round((float) $this->completed($filters)->avg('distance'), 1),
        ];
    }

    /** @param array<string,mixed> $filters @return array<int,array<string,mixed>> */
    private function tripsByVehicle(array $filters): array
    {
        return $this->completed($filters)
            ->select('vehicle_id', DB::raw('count(*) as trips'), DB::raw('sum(distance) as distance'))
            ->with('vehicle:id,vehicle_number')
            ->groupBy('vehicle_id')
            ->get()
            ->map(fn (Trip $t) => [
                'label' => $t->vehicle?->vehicle_number ?? "#{$t->vehicle_id}",
                'trips' => (int) $t->trips,
                'distance' => (int) $t->distance,
            ])->all();
    }

    /** @param array<string,mixed> $filters @return array<int,array<string,mixed>> */
    private function tripsByDriver(array $filters): array
    {
        return $this->completed($filters)
            ->select('driver_id', DB::raw('count(*) as trips'), DB::raw('sum(distance) as distance'))
            ->with('driver:id,name')
            ->groupBy('driver_id')
            ->get()
            ->map(fn (Trip $t) => [
                'label' => $t->driver?->name ?? "#{$t->driver_id}",
                'trips' => (int) $t->trips,
                'distance' => (int) $t->distance,
            ])->all();
    }

    /** @param array<string,mixed> $filters @return array<int,array<string,mixed>> */
    private function tripsByDepartment(array $filters): array
    {
        return $this->completed($filters)
            ->join('vehicle_requests', 'trips.vehicle_request_id', '=', 'vehicle_requests.id')
            ->leftJoin('org_units', 'vehicle_requests.org_unit_id', '=', 'org_units.id')
            // Goodwill trips have no unit — group them under "Goodwill".
            ->select(DB::raw("case when vehicle_requests.is_goodwill = 1 then 'Goodwill' else coalesce(org_units.name, 'Unassigned') end as label"), DB::raw('count(*) as trips'))
            ->groupBy('label')
            ->orderByDesc('trips')
            ->get()
            ->map(fn ($r) => ['label' => $r->label, 'trips' => (int) $r->trips])->all();
    }

    /** @param array<string,mixed> $filters @return array<int,array<string,mixed>> */
    private function tripsByDestination(array $filters): array
    {
        return $this->completed($filters)
            ->join('vehicle_requests', 'trips.vehicle_request_id', '=', 'vehicle_requests.id')
            ->select('vehicle_requests.destination as label', DB::raw('count(*) as trips'))
            ->groupBy('vehicle_requests.destination')
            ->orderByDesc('trips')
            ->limit(15)
            ->get()
            ->map(fn ($r) => ['label' => $r->label, 'trips' => (int) $r->trips])->all();
    }

    /** @param array<string,mixed> $filters @return array<int,array<string,mixed>> */
    private function monthlyUtilisation(array $filters): array
    {
        return $this->completed($filters)
            ->select(
                DB::raw("DATE_FORMAT(scheduled_start, '%Y-%m') as period"),
                DB::raw('count(*) as trips'),
                DB::raw('sum(distance) as distance'),
            )
            ->groupBy('period')
            ->orderBy('period')
            ->get()
            ->map(fn ($r) => ['period' => $r->period, 'trips' => (int) $r->trips, 'distance' => (int) $r->distance])->all();
    }

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    private function distance(array $filters): array
    {
        return [
            'by_vehicle' => $this->tripsByVehicle($filters),
            'by_driver' => $this->tripsByDriver($filters),
            'by_month' => $this->monthlyUtilisation($filters),
        ];
    }

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    private function tripDuration(array $filters): array
    {
        $q = $this->completed($filters)->whereNotNull('duration_minutes');

        return [
            'average_minutes' => round((float) (clone $q)->avg('duration_minutes'), 1),
            'max_minutes' => (int) (clone $q)->max('duration_minutes'),
            'min_minutes' => (int) (clone $q)->min('duration_minutes'),
        ];
    }

    /** @param array<string,mixed> $filters @return array<string,int> */
    private function approvalStatistics(array $filters): array
    {
        $q = VehicleRequest::query()
            ->when($filters['date_from'] ?? null, fn ($qq, $v) => $qq->whereDate('created_at', '>=', $v))
            ->when($filters['date_to'] ?? null, fn ($qq, $v) => $qq->whereDate('created_at', '<=', $v))
            ->when($filters['org_unit_id'] ?? null, fn ($qq, $v) => $qq->where('org_unit_id', $v))
            ->when($filters['requester_id'] ?? null, fn ($qq, $v) => $qq->where('requester_id', $v));

        return [
            'submitted' => (clone $q)->count(),
            'approved' => (clone $q)->whereIn('status', [
                RequestStatus::APPROVED->value, RequestStatus::SCHEDULED->value,
                RequestStatus::IN_PROGRESS->value, RequestStatus::COMPLETED->value,
            ])->count(),
            'rejected' => (clone $q)->where('status', RequestStatus::REJECTED->value)->count(),
            'cancelled' => (clone $q)->where('status', RequestStatus::CANCELLED->value)->count(),
            'pending' => (clone $q)->where('status', RequestStatus::PENDING->value)->count(),
        ];
    }

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    private function peakUsage(array $filters): array
    {
        $byDay = $this->completed($filters)
            ->select(DB::raw('DAYNAME(scheduled_start) as label'), DB::raw('count(*) as trips'))
            ->groupBy('label')->orderByDesc('trips')->get()
            ->map(fn ($r) => ['label' => $r->label, 'trips' => (int) $r->trips])->all();

        $byHour = $this->completed($filters)
            ->select(DB::raw('HOUR(scheduled_start) as label'), DB::raw('count(*) as trips'))
            ->groupBy('label')->orderBy('label')->get()
            ->map(fn ($r) => ['label' => sprintf('%02d:00', (int) $r->label), 'trips' => (int) $r->trips])->all();

        return [
            'most_active_days' => $byDay,
            'most_active_hours' => $byHour,
            'most_active_vehicles' => array_slice($this->tripsByVehicle($filters), 0, 5),
        ];
    }
}

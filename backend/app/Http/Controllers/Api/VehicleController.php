<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreVehicleRequest;
use App\Http\Resources\TripResource;
use App\Http\Resources\VehicleResource;
use App\Http\Resources\FuelLogResource;
use App\Models\Vehicle;
use App\Support\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

class VehicleController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Vehicle::class);

        // Scope to the org units this user may see (null = all, for super admin).
        $scope = $request->user()->visibleOrgUnitIds();

        $query = Vehicle::query()
            ->when($scope !== null, fn ($q) => $q->whereIn('org_unit_id', $scope))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->boolean('active_only'), fn ($q) => $q->where('active', true))
            ->when($request->filled('org_unit_id'), fn ($q) => $q->where('org_unit_id', $request->integer('org_unit_id')))
            ->when($request->filled('search'), function ($q) use ($request) {
                $s = $request->string('search');
                $q->where(fn ($qq) => $qq->where('vehicle_number', 'like', "%{$s}%")
                    ->orWhere('registration_number', 'like', "%{$s}%")
                    ->orWhere('make', 'like', "%{$s}%")
                    ->orWhere('model', 'like', "%{$s}%"));
            })
            ->with(['activeTrip.driver', 'orgUnit'])
            ->orderBy('vehicle_number');

        if ($request->boolean('all')) {
            return VehicleResource::collection($query->get());
        }

        return VehicleResource::collection($query->paginate($request->integer('per_page', 15)));
    }

    public function store(StoreVehicleRequest $request): JsonResponse
    {
        $this->authorize('create', Vehicle::class);

        $data = $request->validated();
        // Default the vehicle to the creator's own unit; a chosen unit must be
        // within the creator's scope (super admin may pick any).
        $data['org_unit_id'] = $this->resolveOrgUnit($request->user(), $data['org_unit_id'] ?? null);

        $vehicle = Vehicle::create($data);
        AuditLogger::log('vehicle.created', "Vehicle {$vehicle->vehicle_number} was added", $vehicle, null, $data);

        // fresh() so DB defaults (e.g. status) are reflected before serialising.
        return (new VehicleResource($vehicle->fresh('orgUnit')))->response()->setStatusCode(201);
    }

    public function show(Vehicle $vehicle): VehicleResource
    {
        $this->authorize('view', $vehicle);

        return new VehicleResource($vehicle->load(['activeTrip.driver', 'orgUnit']));
    }

    public function update(StoreVehicleRequest $request, Vehicle $vehicle): VehicleResource
    {
        $this->authorize('update', $vehicle);

        $data = $request->validated();
        if (array_key_exists('org_unit_id', $data)) {
            $data['org_unit_id'] = $this->resolveOrgUnit($request->user(), $data['org_unit_id']);
        }

        $old = $vehicle->only(array_keys($data));
        $vehicle->update($data);
        AuditLogger::log('vehicle.updated', "Vehicle {$vehicle->vehicle_number} was updated", $vehicle, $old, $data);

        return new VehicleResource($vehicle->fresh('orgUnit'));
    }

    /**
     * Constrain a chosen org unit to the actor's scope; default to the actor's
     * own unit when none is given.
     */
    private function resolveOrgUnit(\App\Models\User $user, ?int $orgUnitId): ?int
    {
        $scope = $user->visibleOrgUnitIds();
        if ($orgUnitId && ($scope === null || in_array($orgUnitId, $scope, true))) {
            return $orgUnitId;
        }

        return $user->org_unit_id;
    }

    public function destroy(Vehicle $vehicle): JsonResponse
    {
        $this->authorize('delete', $vehicle);

        $vehicle->delete(); // soft delete
        AuditLogger::log('vehicle.deleted', "Vehicle {$vehicle->vehicle_number} was removed", $vehicle);

        return response()->json(['message' => 'Vehicle removed.']);
    }

    /** Deactivate or reactivate a vehicle (active flag + status). */
    public function setActive(Request $request, Vehicle $vehicle): VehicleResource
    {
        $this->authorize('update', $vehicle);
        $active = $request->boolean('active');

        if (! $active && in_array($vehicle->status, [\App\Enums\VehicleStatus::ON_TRIP, \App\Enums\VehicleStatus::SCHEDULED], true)) {
            throw new \App\Exceptions\BusinessRuleException('This vehicle is on a trip or scheduled and cannot be deactivated.');
        }

        $vehicle->update([
            'active' => $active,
            'status' => $active ? \App\Enums\VehicleStatus::AVAILABLE : \App\Enums\VehicleStatus::INACTIVE,
        ]);

        AuditLogger::log(
            $active ? 'vehicle.activated' : 'vehicle.deactivated',
            "Vehicle {$vehicle->vehicle_number} was ".($active ? 'reactivated' : 'deactivated'),
            $vehicle,
        );

        return new VehicleResource($vehicle->fresh());
    }

    /** Vehicle history report data (all trips for this vehicle). */
    public function trips(Vehicle $vehicle): AnonymousResourceCollection
    {
        $this->authorize('view', $vehicle);

        return TripResource::collection(
            $vehicle->trips()->with(['driver', 'vehicleRequest.requester', 'vehicleRequest.department'])
                ->orderByDesc('scheduled_start')->paginate(20)
        );
    }

    /**
     * Fuel spend & economy for a single vehicle: a summary plus recent purchases.
     * Economy (km/L) and cost/km use only fills that carry a previous-purchase
     * odometer, since distance-per-tank is undefined for the first recorded fill.
     */
    public function fuel(Vehicle $vehicle): JsonResponse
    {
        $this->authorize('view', $vehicle);

        $totalCost = (float) $vehicle->fuelLogs()->sum('total_cost');
        $totalLitres = (float) $vehicle->fuelLogs()->sum('litres');
        $fills = $vehicle->fuelLogs()->count();

        $measuredDistance = (int) $vehicle->fuelLogs()->whereNotNull('previous_odometer')->sum(DB::raw('odometer - previous_odometer'));
        $measuredLitres = (float) $vehicle->fuelLogs()->whereNotNull('previous_odometer')->sum('litres');
        $measuredCost = (float) $vehicle->fuelLogs()->whereNotNull('previous_odometer')->sum('total_cost');

        $last = $vehicle->fuelLogs()->orderByDesc('purchase_date')->orderByDesc('odometer')->first();

        $recent = $vehicle->fuelLogs()->with('driver')
            ->orderByDesc('purchase_date')->orderByDesc('odometer')->limit(10)->get();

        return response()->json([
            'summary' => [
                'total_cost' => round($totalCost, 2),
                'total_litres' => round($totalLitres, 2),
                'fills' => $fills,
                'avg_price_per_litre' => $totalLitres > 0 ? round($totalCost / $totalLitres, 3) : null,
                'km_per_litre' => $measuredLitres > 0 ? round($measuredDistance / $measuredLitres, 3) : null,
                'cost_per_km' => $measuredDistance > 0 ? round($measuredCost / $measuredDistance, 3) : null,
                'measured_distance' => $measuredDistance,
                'last_purchase_date' => $last?->purchase_date,
            ],
            'recent' => FuelLogResource::collection($recent),
        ]);
    }
}

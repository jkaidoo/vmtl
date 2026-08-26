<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\BusinessRuleException;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreFuelLogRequest;
use App\Http\Resources\FuelLogResource;
use App\Models\FuelLog;
use App\Models\Vehicle;
use App\Support\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class FuelLogController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', FuelLog::class);

        $query = FuelLog::with(['vehicle', 'driver', 'recordedBy'])
            ->when($request->filled('vehicle_id'), fn ($q) => $q->where('vehicle_id', $request->integer('vehicle_id')))
            ->when($request->filled('date_from'), fn ($q) => $q->whereDate('purchase_date', '>=', $request->date('date_from')))
            ->when($request->filled('date_to'), fn ($q) => $q->whereDate('purchase_date', '<=', $request->date('date_to')))
            ->orderByDesc('purchase_date')
            ->orderByDesc('odometer');

        return FuelLogResource::collection($query->paginate($request->integer('per_page', 15)));
    }

    public function store(StoreFuelLogRequest $request): JsonResponse
    {
        $this->authorize('create', FuelLog::class);

        $data = $request->validated();

        // The odometer at the previous fuel purchase for this vehicle (the fill-up
        // immediately before this one on the timeline) — used to derive distance
        // per tank and fuel economy.
        $previous = FuelLog::where('vehicle_id', $data['vehicle_id'])
            ->where(function ($q) use ($data) {
                $q->where('purchase_date', '<', $data['purchase_date'])
                    ->orWhere(function ($qq) use ($data) {
                        $qq->where('purchase_date', $data['purchase_date'])
                            ->where('odometer', '<', $data['odometer']);
                    });
            })
            ->orderByDesc('purchase_date')
            ->orderByDesc('odometer')
            ->first();

        if ($previous && $data['odometer'] < $previous->odometer) {
            throw new BusinessRuleException(
                "Odometer ({$data['odometer']} km) cannot be below the previous fuel purchase reading ({$previous->odometer} km)."
            );
        }

        $log = FuelLog::create([
            ...$data,
            'previous_odometer' => $previous?->odometer,
            'total_cost' => round((float) $data['litres'] * (float) $data['price_per_litre'], 2),
            'recorded_by' => $request->user()->id,
        ]);

        // Keep the vehicle's odometer in step if this reading is the newest.
        $vehicle = Vehicle::find($log->vehicle_id);
        if ($vehicle && $log->odometer > (int) $vehicle->current_odometer) {
            $vehicle->update(['current_odometer' => $log->odometer]);
        }

        AuditLogger::log(
            'fuel.logged',
            "Fuel purchase ({$log->litres} L) recorded for {$vehicle?->vehicle_number}",
            $log,
            null,
            $data,
        );

        return (new FuelLogResource($log->load(['vehicle', 'driver'])))->response()->setStatusCode(201);
    }

    public function show(FuelLog $fuelLog): FuelLogResource
    {
        $this->authorize('view', $fuelLog);

        return new FuelLogResource($fuelLog->load(['vehicle', 'driver', 'recordedBy']));
    }

    public function update(StoreFuelLogRequest $request, FuelLog $fuelLog): FuelLogResource
    {
        $this->authorize('update', $fuelLog);

        $data = $request->validated();
        $old = $fuelLog->only(array_keys($data));
        $fuelLog->update([
            ...$data,
            'total_cost' => round((float) $data['litres'] * (float) $data['price_per_litre'], 2),
        ]);

        AuditLogger::log('fuel.updated', "Fuel log #{$fuelLog->id} was updated", $fuelLog, $old, $data);

        return new FuelLogResource($fuelLog->fresh(['vehicle', 'driver']));
    }

    public function destroy(FuelLog $fuelLog): JsonResponse
    {
        $this->authorize('delete', $fuelLog);

        $fuelLog->delete();
        AuditLogger::log('fuel.deleted', "Fuel log #{$fuelLog->id} was removed", $fuelLog);

        return response()->json(['message' => 'Fuel log removed.']);
    }
}

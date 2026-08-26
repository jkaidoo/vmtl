<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreMaintenanceRecordRequest;
use App\Http\Resources\MaintenanceRecordResource;
use App\Models\MaintenanceRecord;
use App\Models\Vehicle;
use App\Support\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class MaintenanceRecordController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', MaintenanceRecord::class);

        $query = MaintenanceRecord::with(['vehicle', 'recordedBy'])
            ->when($request->filled('vehicle_id'), fn ($q) => $q->where('vehicle_id', $request->integer('vehicle_id')))
            ->when($request->filled('maintenance_type'), fn ($q) => $q->where('maintenance_type', $request->string('maintenance_type')))
            ->orderByDesc('service_date');

        return MaintenanceRecordResource::collection($query->paginate($request->integer('per_page', 15)));
    }

    public function store(StoreMaintenanceRecordRequest $request): JsonResponse
    {
        $this->authorize('create', MaintenanceRecord::class);

        $record = MaintenanceRecord::create([
            ...$request->validated(),
            'recorded_by' => $request->user()->id,
        ]);

        // Keep the vehicle's last-service markers in step with the newest record.
        $vehicle = Vehicle::find($record->vehicle_id);
        if ($vehicle) {
            $updates = ['last_service_date' => $record->service_date];
            if ($record->odometer) {
                $updates['last_service_odometer'] = $record->odometer;
            }
            $vehicle->update($updates);
        }

        AuditLogger::log('maintenance.created', "Maintenance ({$record->maintenance_type->label()}) recorded for {$vehicle?->vehicle_number}", $record, null, $request->validated());

        return (new MaintenanceRecordResource($record->load('vehicle')))->response()->setStatusCode(201);
    }

    public function show(MaintenanceRecord $maintenanceRecord): MaintenanceRecordResource
    {
        $this->authorize('view', $maintenanceRecord);

        return new MaintenanceRecordResource($maintenanceRecord->load(['vehicle', 'recordedBy']));
    }

    public function update(StoreMaintenanceRecordRequest $request, MaintenanceRecord $maintenanceRecord): MaintenanceRecordResource
    {
        $this->authorize('update', $maintenanceRecord);

        $old = $maintenanceRecord->only(array_keys($request->validated()));
        $maintenanceRecord->update($request->validated());
        AuditLogger::log('maintenance.updated', "Maintenance record #{$maintenanceRecord->id} was updated", $maintenanceRecord, $old, $request->validated());

        return new MaintenanceRecordResource($maintenanceRecord->fresh('vehicle'));
    }

    public function destroy(MaintenanceRecord $maintenanceRecord): JsonResponse
    {
        $this->authorize('delete', $maintenanceRecord);

        $maintenanceRecord->delete();
        AuditLogger::log('maintenance.deleted', "Maintenance record #{$maintenanceRecord->id} was removed", $maintenanceRecord);

        return response()->json(['message' => 'Maintenance record removed.']);
    }
}

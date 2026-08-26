<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MaintenanceRecordResource extends JsonResource
{
    /** @return array<string,mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'vehicle_id' => $this->vehicle_id,
            'vehicle' => new VehicleResource($this->whenLoaded('vehicle')),
            'maintenance_type' => $this->maintenance_type->value,
            'maintenance_type_label' => $this->maintenance_type->label(),
            'service_date' => $this->service_date?->toDateString(),
            'odometer' => $this->odometer,
            'description' => $this->description,
            'cost' => $this->cost,
            'service_provider' => $this->service_provider,
            'next_service_date' => $this->next_service_date?->toDateString(),
            'next_service_odometer' => $this->next_service_odometer,
            'remarks' => $this->remarks,
            'recorded_by' => new UserResource($this->whenLoaded('recordedBy')),
            'created_at' => $this->created_at,
        ];
    }
}

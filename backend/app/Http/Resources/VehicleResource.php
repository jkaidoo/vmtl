<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class VehicleResource extends JsonResource
{
    /** @return array<string,mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'vehicle_number' => $this->vehicle_number,
            'registration_number' => $this->registration_number,
            'make' => $this->make,
            'model' => $this->model,
            'year' => $this->year,
            'vehicle_type' => $this->vehicle_type,
            'colour' => $this->colour,
            'capacity' => $this->capacity,
            'current_odometer' => $this->current_odometer,
            'status' => $this->status->value,
            'status_label' => $this->status->label(),
            'status_color' => $this->status->color(),
            'acquisition_date' => $this->acquisition_date?->toDateString(),
            'insurance_expiry' => $this->insurance_expiry?->toDateString(),
            'roadworthy_expiry' => $this->roadworthy_expiry?->toDateString(),
            'service_interval_km' => $this->service_interval_km,
            'last_service_date' => $this->last_service_date?->toDateString(),
            'last_service_odometer' => $this->last_service_odometer,
            'notes' => $this->notes,
            'active' => $this->active,
            'org_unit_id' => $this->org_unit_id,
            'org_unit' => $this->whenLoaded('orgUnit', fn () => $this->orgUnit ? ['id' => $this->orgUnit->id, 'name' => $this->orgUnit->name, 'type' => $this->orgUnit->type->value] : null),
            'active_trip' => new TripResource($this->whenLoaded('activeTrip')),
            'created_at' => $this->created_at,
        ];
    }
}

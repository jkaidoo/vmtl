<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FuelLogResource extends JsonResource
{
    /** @return array<string,mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'vehicle_id' => $this->vehicle_id,
            'vehicle' => new VehicleResource($this->whenLoaded('vehicle')),
            'driver_id' => $this->driver_id,
            'driver' => new DriverResource($this->whenLoaded('driver')),
            'purchase_date' => $this->purchase_date,
            'odometer' => $this->odometer,
            'previous_odometer' => $this->previous_odometer,
            'distance_since_last' => $this->distanceSinceLast(),
            'litres' => $this->litres,
            'price_per_litre' => $this->price_per_litre,
            'total_cost' => $this->total_cost,
            'km_per_litre' => $this->kmPerLitre(),
            'fuel_type' => $this->fuel_type,
            'station' => $this->station,
            'notes' => $this->notes,
            'recorded_by' => new UserResource($this->whenLoaded('recordedBy')),
            'created_at' => $this->created_at,
        ];
    }
}

<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class TripResource extends JsonResource
{
    /** @return array<string,mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'trip_number' => $this->trip_number,
            'vehicle_request_id' => $this->vehicle_request_id,
            'vehicle' => new VehicleResource($this->whenLoaded('vehicle')),
            'vehicle_id' => $this->vehicle_id,
            'driver' => new DriverResource($this->whenLoaded('driver')),
            'driver_id' => $this->driver_id,
            'request' => new VehicleRequestResource($this->whenLoaded('vehicleRequest')),
            'scheduled_start' => $this->scheduled_start,
            'scheduled_end' => $this->scheduled_end,
            'actual_start' => $this->actual_start,
            'actual_end' => $this->actual_end,
            'starting_odometer' => $this->starting_odometer,
            'ending_odometer' => $this->ending_odometer,
            'distance' => $this->distance,
            'duration_minutes' => $this->duration_minutes,
            'status' => $this->status->value,
            'status_label' => $this->status->label(),
            'status_color' => $this->status->color(),
            'start_notes' => $this->start_notes,
            'end_notes' => $this->end_notes,
            'admin_remarks' => $this->admin_remarks,
            'started_by' => new UserResource($this->whenLoaded('startedBy')),
            'ended_by' => new UserResource($this->whenLoaded('endedBy')),
            'stops' => $this->whenLoaded('stops', fn () => $this->stops->map(fn ($s) => [
                'id' => $s->id,
                'destination' => $s->destination,
                'note' => $s->note,
                'status' => $s->status,
                'requested_by' => $s->requestedBy?->name,
                'decided_by' => $s->decidedBy?->name,
                'decided_at' => $s->decided_at,
                'created_at' => $s->created_at,
            ])),
            'created_at' => $this->created_at,
        ];
    }
}

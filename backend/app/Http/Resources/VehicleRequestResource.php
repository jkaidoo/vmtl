<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class VehicleRequestResource extends JsonResource
{
    /** @return array<string,mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'request_number' => $this->request_number,
            'requester' => new UserResource($this->whenLoaded('requester')),
            'requester_id' => $this->requester_id,
            'department' => new DepartmentResource($this->whenLoaded('department')),
            'department_id' => $this->department_id,
            // Goodwill trips are not tied to a department — they read "Goodwill".
            'department_label' => $this->is_goodwill ? 'Goodwill' : ($this->department?->name),
            'travel_date' => $this->travel_date?->toDateString(),
            'requested_start_time' => $this->requested_start_time,
            'expected_end_time' => $this->expected_end_time,
            'destination' => $this->destination,
            'additional_destination' => $this->additional_destination,
            'purpose' => $this->purpose,
            'passenger_count' => $this->passenger_count,
            'contact_number' => $this->contact_number,
            'special_requirements' => $this->special_requirements,
            'remarks' => $this->remarks,
            'status' => $this->status->value,
            'status_label' => $this->status->label(),
            'status_color' => $this->status->color(),
            'is_cancellable' => $this->status->isCancellable(),
            'is_goodwill' => (bool) $this->is_goodwill,
            'goodwill_reason' => $this->goodwill_reason,
            'is_external' => (bool) $this->is_external,
            'external_org' => $this->external_org,
            'expected_duration_days' => $this->expected_duration_days,
            'start_odometer' => $this->start_odometer,
            'approvals' => RequestApprovalResource::collection($this->whenLoaded('approvals')),
            'latest_approval' => new RequestApprovalResource($this->whenLoaded('latestApproval')),
            'trip' => new TripResource($this->whenLoaded('trip')),
            'created_at' => $this->created_at,
        ];
    }
}

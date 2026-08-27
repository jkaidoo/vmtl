<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DriverResource extends JsonResource
{
    /** @return array<string,mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'user_id' => $this->user_id,
            'name' => $this->name,
            'employee_id' => $this->employee_id,
            'phone' => $this->phone,
            'licence_number' => $this->licence_number,
            'licence_expiry' => $this->licence_expiry?->toDateString(),
            'status' => $this->status->value,
            'status_label' => $this->status->label(),
            'status_color' => $this->status->color(),
            'notes' => $this->notes,
            'active' => $this->active,
            'org_unit_id' => $this->org_unit_id,
            'org_unit' => $this->whenLoaded('orgUnit', fn () => $this->orgUnit ? ['id' => $this->orgUnit->id, 'name' => $this->orgUnit->name, 'type' => $this->orgUnit->type->value] : null),
            'has_account' => $this->user_id !== null,
            'account_email' => $this->whenLoaded('user', fn () => $this->user?->email),
            'created_at' => $this->created_at,
        ];
    }
}

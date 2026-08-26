<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class RequestApprovalResource extends JsonResource
{
    /** @return array<string,mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'action' => $this->action->value,
            'action_label' => $this->action->label(),
            'comment' => $this->comment,
            'approver' => new UserResource($this->whenLoaded('approver')),
            'approved_at' => $this->approved_at,
            'created_at' => $this->created_at,
        ];
    }
}

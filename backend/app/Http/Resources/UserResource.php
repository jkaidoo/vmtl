<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    /** @return array<string,mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'phone' => $this->phone,
            'active' => $this->active,
            'avatar' => $this->avatar,
            'role' => $this->whenLoaded('role', fn () => [
                'id' => $this->role?->id,
                'slug' => $this->role?->slug,
                'name' => $this->role?->name,
            ]),
            'role_slug' => $this->role?->slug,
            'is_super_admin' => (bool) $this->is_super_admin,
            'department' => new DepartmentResource($this->whenLoaded('department')),
            'department_id' => $this->department_id,
            // Capabilities are only serialised for the authenticated user (their own record).
            'capabilities' => $this->when(
                $request->user()?->id === $this->id,
                fn () => $this->capabilities(),
            ),
            'created_at' => $this->created_at,
        ];
    }
}

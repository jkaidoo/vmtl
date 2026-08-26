<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Role;
use App\Models\RoleCapability;
use App\Support\AuditLogger;
use App\Support\Capabilities;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RbacController extends Controller
{
    public function index(): JsonResponse
    {
        $catalog = collect(Capabilities::catalog())->map(fn ($meta, $key) => [
            'key' => $key,
            'label' => $meta['label'],
            'group' => $meta['group'],
            'description' => $meta['description'],
        ])->values();

        $roles = Role::with('capabilities')->orderBy('id')->get()->map(fn (Role $role) => [
            'id' => $role->id,
            'slug' => $role->slug,
            'name' => $role->name,
            'description' => $role->description,
            'capabilities' => $role->capabilities->pluck('capability')->all(),
        ]);

        return response()->json([
            'data' => [
                'capabilities' => $catalog,
                'roles' => $roles,
                'scopes' => [
                    ['key' => 'OWN', 'description' => 'Acts only on records the user owns (their requests, their trips).'],
                    ['key' => 'TEAM', 'description' => 'Acts on records within the user’s department or team.'],
                    ['key' => 'ALL', 'description' => 'Acts on every record in the system.'],
                ],
                'note' => 'The System Administrator (break-glass) implicitly holds every capability.',
            ],
        ]);
    }

    public function updateRoleCapabilities(Request $request, Role $role): JsonResponse
    {
        $validated = $request->validate([
            'capabilities' => ['present', 'array'],
            'capabilities.*' => ['string', 'in:'.implode(',', Capabilities::all())],
        ]);

        $desired = array_values(array_unique($validated['capabilities']));
        $current = $role->capabilities()->pluck('capability')->all();

        // Remove revoked, add granted.
        RoleCapability::where('role_id', $role->id)->whereNotIn('capability', $desired)->delete();
        foreach (array_diff($desired, $current) as $cap) {
            RoleCapability::updateOrCreate(['role_id' => $role->id, 'capability' => $cap]);
        }

        AuditLogger::log(
            'rbac.updated',
            "{$request->user()->name} updated capabilities for role {$role->name}",
            $role,
            ['capabilities' => $current],
            ['capabilities' => $desired],
        );

        return $this->index();
    }
}

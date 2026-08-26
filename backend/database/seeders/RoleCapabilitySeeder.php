<?php

namespace Database\Seeders;

use App\Models\Role;
use App\Models\RoleCapability;
use App\Support\Capabilities;
use Illuminate\Database\Seeder;

class RoleCapabilitySeeder extends Seeder
{
    public function run(): void
    {
        $roles = Role::pluck('id', 'slug');

        foreach (Capabilities::defaultsByRole() as $slug => $caps) {
            $roleId = $roles[$slug] ?? null;
            if (! $roleId) {
                continue;
            }

            foreach ($caps as $cap) {
                RoleCapability::updateOrCreate(['role_id' => $roleId, 'capability' => $cap]);
            }
        }
    }
}

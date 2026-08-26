<?php

namespace Database\Seeders;

use App\Enums\RoleType;
use App\Models\Role;
use Illuminate\Database\Seeder;

class RoleSeeder extends Seeder
{
    public function run(): void
    {
        $roles = [
            RoleType::STAFF->value => ['name' => 'Staff', 'description' => 'Can create and track their own vehicle requests.'],
            RoleType::APPROVER->value => ['name' => 'Approver', 'description' => 'Reviews and approves or rejects vehicle requests.'],
            RoleType::TRANSPORT_ADMIN->value => ['name' => 'Transport / Admin Officer', 'description' => 'Assigns vehicles and drivers, runs trips.'],
            RoleType::ADMINISTRATOR->value => ['name' => 'System Administrator', 'description' => 'Full system access.'],
            RoleType::DRIVER->value => ['name' => 'Driver', 'description' => 'Views and operates their own assigned trips.'],
        ];

        foreach ($roles as $slug => $data) {
            Role::updateOrCreate(['slug' => $slug], $data);
        }
    }
}

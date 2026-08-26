<?php

namespace Database\Seeders;

use App\Enums\RoleType;
use App\Models\Department;
use App\Models\Role;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class UserSeeder extends Seeder
{
    public function run(): void
    {
        $roles = Role::pluck('id', 'slug');
        $dept = Department::first();

        $users = [
            ['name' => 'System Administrator', 'email' => 'admin@uits.test', 'role' => RoleType::ADMINISTRATOR],
            ['name' => 'Approving Officer', 'email' => 'approver@uits.test', 'role' => RoleType::APPROVER],
            ['name' => 'Transport Officer', 'email' => 'transport@uits.test', 'role' => RoleType::TRANSPORT_ADMIN],
            ['name' => 'Staff Member', 'email' => 'staff@uits.test', 'role' => RoleType::STAFF],
            ['name' => 'Ama Mensah', 'email' => 'ama@uits.test', 'role' => RoleType::STAFF],
            ['name' => 'Kofi Boateng', 'email' => 'kofi@uits.test', 'role' => RoleType::STAFF],
        ];

        foreach ($users as $u) {
            User::updateOrCreate(
                ['email' => $u['email']],
                [
                    'name' => $u['name'],
                    'password' => Hash::make('password'),
                    'role_id' => $roles[$u['role']->value] ?? null,
                    'department_id' => $dept?->id,
                    'active' => true,
                    'email_verified_at' => now(),
                    // The primary administrator is the break-glass System Administrator.
                    'is_super_admin' => $u['email'] === 'admin@uits.test',
                ]
            );
        }
    }
}

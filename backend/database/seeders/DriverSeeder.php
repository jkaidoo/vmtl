<?php

namespace Database\Seeders;

use App\Enums\DriverStatus;
use App\Enums\RoleType;
use App\Models\Driver;
use App\Models\Role;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DriverSeeder extends Seeder
{
    public function run(): void
    {
        $driverRoleId = Role::where('slug', RoleType::DRIVER->value)->value('id');

        $drivers = [
            [
                'name' => 'Driver A — Yaw Owusu',
                'employee_id' => 'DRV-001',
                'phone' => '+233 24 000 0001',
                'licence_number' => 'GHA-DL-11111',
                'licence_expiry' => now()->addMonths(8)->toDateString(),
                'status' => DriverStatus::AVAILABLE,
                'email' => 'driver1@uits.test',
            ],
            [
                'name' => 'Driver B — Kwabena Asare',
                'employee_id' => 'DRV-002',
                'phone' => '+233 24 000 0002',
                'licence_number' => 'GHA-DL-22222',
                'licence_expiry' => now()->addDays(25)->toDateString(),
                'status' => DriverStatus::AVAILABLE,
                'email' => 'driver2@uits.test',
            ],
        ];

        foreach ($drivers as $d) {
            $email = $d['email'];
            unset($d['email']);

            // Provision the self-service login account for the driver.
            $user = User::updateOrCreate(
                ['email' => $email],
                [
                    'name' => $d['name'],
                    'password' => Hash::make('password'),
                    'role_id' => $driverRoleId,
                    'phone' => $d['phone'],
                    'active' => true,
                    'email_verified_at' => now(),
                ]
            );

            Driver::updateOrCreate(
                ['employee_id' => $d['employee_id']],
                $d + ['active' => true, 'user_id' => $user->id]
            );
        }
    }
}

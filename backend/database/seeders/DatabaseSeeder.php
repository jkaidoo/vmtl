<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            RoleSeeder::class,
            RoleCapabilitySeeder::class,
            DepartmentSeeder::class,
            UserSeeder::class,
            VehicleSeeder::class,
            DriverSeeder::class,
            SystemSettingSeeder::class,
            DemoDataSeeder::class,
        ]);
    }
}

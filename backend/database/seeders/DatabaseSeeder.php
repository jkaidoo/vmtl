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
            // Builds the real KNUST org tree and re-points the demo accounts/fleet
            // onto it — must run last so the demo users/vehicles/drivers exist.
            KnustOrgStructureSeeder::class,
        ]);
    }
}

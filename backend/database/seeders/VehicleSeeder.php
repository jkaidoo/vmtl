<?php

namespace Database\Seeders;

use App\Enums\VehicleStatus;
use App\Models\Vehicle;
use Illuminate\Database\Seeder;

class VehicleSeeder extends Seeder
{
    public function run(): void
    {
        $vehicles = [
            [
                'vehicle_number' => 'UITS-01',
                'registration_number' => 'GR-1234-24',
                'make' => 'Toyota',
                'model' => 'Hilux',
                'year' => 2022,
                'vehicle_type' => 'Pickup',
                'colour' => 'White',
                'capacity' => 5,
                'current_odometer' => 42310,
                'status' => VehicleStatus::AVAILABLE,
                'acquisition_date' => now()->subYears(2)->toDateString(),
                'insurance_expiry' => now()->addDays(45)->toDateString(),
                'roadworthy_expiry' => now()->addDays(20)->toDateString(),
                'service_interval_km' => 10000,
                'last_service_date' => now()->subMonths(2)->toDateString(),
                'last_service_odometer' => 38000,
            ],
            [
                'vehicle_number' => 'UITS-02',
                'registration_number' => 'GR-5678-24',
                'make' => 'Nissan',
                'model' => 'Navara',
                'year' => 2021,
                'vehicle_type' => 'Pickup',
                'colour' => 'Silver',
                'capacity' => 5,
                'current_odometer' => 61540,
                'status' => VehicleStatus::AVAILABLE,
                'acquisition_date' => now()->subYears(3)->toDateString(),
                'insurance_expiry' => now()->addMonths(6)->toDateString(),
                'roadworthy_expiry' => now()->addMonths(4)->toDateString(),
                'service_interval_km' => 10000,
                'last_service_date' => now()->subMonths(1)->toDateString(),
                'last_service_odometer' => 60000,
            ],
        ];

        foreach ($vehicles as $v) {
            Vehicle::updateOrCreate(['vehicle_number' => $v['vehicle_number']], $v + ['active' => true]);
        }
    }
}

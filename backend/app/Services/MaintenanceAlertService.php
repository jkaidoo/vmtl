<?php

namespace App\Services;

use App\Models\Driver;
use App\Models\Vehicle;
use App\Models\SystemSetting;

class MaintenanceAlertService
{
    private function days(string $settingKey, string $envKey, int $default): int
    {
        return (int) SystemSetting::get($settingKey, (int) env($envKey, $default));
    }

    /** @return array<string,mixed> */
    public function all(): array
    {
        $insuranceDays = $this->days('alert_insurance_days', 'ALERT_INSURANCE_DAYS', 30);
        $roadworthyDays = $this->days('alert_roadworthy_days', 'ALERT_ROADWORTHY_DAYS', 30);
        $licenceDays = $this->days('alert_licence_days', 'ALERT_LICENCE_DAYS', 30);

        $today = today();

        $insurance = Vehicle::where('active', true)
            ->whereNotNull('insurance_expiry')
            ->whereDate('insurance_expiry', '<=', $today->copy()->addDays($insuranceDays))
            ->orderBy('insurance_expiry')
            ->get(['id', 'vehicle_number', 'insurance_expiry'])
            ->map(fn (Vehicle $v) => [
                'vehicle_id' => $v->id,
                'vehicle_number' => $v->vehicle_number,
                'expiry' => $v->insurance_expiry?->toDateString(),
                'days_left' => (int) $today->diffInDays($v->insurance_expiry, false),
            ]);

        $roadworthy = Vehicle::where('active', true)
            ->whereNotNull('roadworthy_expiry')
            ->whereDate('roadworthy_expiry', '<=', $today->copy()->addDays($roadworthyDays))
            ->orderBy('roadworthy_expiry')
            ->get(['id', 'vehicle_number', 'roadworthy_expiry'])
            ->map(fn (Vehicle $v) => [
                'vehicle_id' => $v->id,
                'vehicle_number' => $v->vehicle_number,
                'expiry' => $v->roadworthy_expiry?->toDateString(),
                'days_left' => (int) $today->diffInDays($v->roadworthy_expiry, false),
            ]);

        // Service due: current odometer within (or past) the service interval since last service.
        $service = Vehicle::where('active', true)
            ->whereNotNull('service_interval_km')
            ->whereNotNull('last_service_odometer')
            ->get()
            ->filter(fn (Vehicle $v) => ($v->current_odometer - $v->last_service_odometer) >= ($v->service_interval_km - 500))
            ->map(fn (Vehicle $v) => [
                'vehicle_id' => $v->id,
                'vehicle_number' => $v->vehicle_number,
                'km_since_service' => $v->current_odometer - $v->last_service_odometer,
                'interval' => $v->service_interval_km,
            ])->values();

        $licences = Driver::where('active', true)
            ->whereNotNull('licence_expiry')
            ->whereDate('licence_expiry', '<=', $today->copy()->addDays($licenceDays))
            ->orderBy('licence_expiry')
            ->get(['id', 'name', 'licence_expiry'])
            ->map(fn (Driver $d) => [
                'driver_id' => $d->id,
                'name' => $d->name,
                'expiry' => $d->licence_expiry?->toDateString(),
                'days_left' => (int) $today->diffInDays($d->licence_expiry, false),
            ]);

        return [
            'insurance_expiring' => $insurance->values(),
            'roadworthy_expiring' => $roadworthy->values(),
            'service_due' => $service,
            'licence_expiring' => $licences->values(),
            'total' => $insurance->count() + $roadworthy->count() + $service->count() + $licences->count(),
        ];
    }
}

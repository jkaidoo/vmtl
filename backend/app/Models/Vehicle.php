<?php

namespace App\Models;

use App\Enums\VehicleStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Vehicle extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'vehicle_number',
        'registration_number',
        'make',
        'model',
        'year',
        'vehicle_type',
        'colour',
        'capacity',
        'current_odometer',
        'status',
        'acquisition_date',
        'insurance_expiry',
        'roadworthy_expiry',
        'service_interval_km',
        'last_service_date',
        'last_service_odometer',
        'notes',
        'active',
    ];

    protected function casts(): array
    {
        return [
            'status' => VehicleStatus::class,
            'acquisition_date' => 'date',
            'insurance_expiry' => 'date',
            'roadworthy_expiry' => 'date',
            'last_service_date' => 'date',
            'active' => 'boolean',
            'capacity' => 'integer',
            'year' => 'integer',
            'current_odometer' => 'integer',
            'service_interval_km' => 'integer',
            'last_service_odometer' => 'integer',
        ];
    }

    public function trips(): HasMany
    {
        return $this->hasMany(Trip::class);
    }

    public function maintenanceRecords(): HasMany
    {
        return $this->hasMany(MaintenanceRecord::class);
    }

    public function odometerReadings(): HasMany
    {
        return $this->hasMany(OdometerReading::class);
    }

    public function fuelLogs(): HasMany
    {
        return $this->hasMany(FuelLog::class);
    }

    /** The trip currently in progress on this vehicle, if any. */
    public function activeTrip()
    {
        return $this->hasOne(Trip::class)->where('status', \App\Enums\TripStatus::IN_PROGRESS->value);
    }
}

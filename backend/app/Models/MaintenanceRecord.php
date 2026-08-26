<?php

namespace App\Models;

use App\Enums\MaintenanceType;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class MaintenanceRecord extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'vehicle_id',
        'maintenance_type',
        'service_date',
        'odometer',
        'description',
        'cost',
        'service_provider',
        'next_service_date',
        'next_service_odometer',
        'remarks',
        'recorded_by',
    ];

    protected function casts(): array
    {
        return [
            'maintenance_type' => MaintenanceType::class,
            'service_date' => 'date',
            'next_service_date' => 'date',
            'cost' => 'decimal:2',
            'odometer' => 'integer',
            'next_service_odometer' => 'integer',
        ];
    }

    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    public function recordedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }
}

<?php

namespace App\Models;

use App\Enums\TripStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Trip extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'trip_number',
        'vehicle_request_id',
        'vehicle_id',
        'driver_id',
        'scheduled_start',
        'scheduled_end',
        'actual_start',
        'actual_end',
        'starting_odometer',
        'ending_odometer',
        'distance',
        'duration_minutes',
        'status',
        'start_notes',
        'end_notes',
        'admin_remarks',
        'assigned_by',
        'started_by',
        'ended_by',
    ];

    protected function casts(): array
    {
        return [
            'status' => TripStatus::class,
            'scheduled_start' => 'datetime',
            'scheduled_end' => 'datetime',
            'actual_start' => 'datetime',
            'actual_end' => 'datetime',
            'starting_odometer' => 'integer',
            'ending_odometer' => 'integer',
            'distance' => 'integer',
            'duration_minutes' => 'integer',
        ];
    }

    public function vehicleRequest(): BelongsTo
    {
        return $this->belongsTo(VehicleRequest::class);
    }

    public function stops(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(TripStop::class)->latest();
    }

    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    public function assignedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_by');
    }

    public function startedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'started_by');
    }

    public function endedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'ended_by');
    }
}

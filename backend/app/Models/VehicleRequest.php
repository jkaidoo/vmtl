<?php

namespace App\Models;

use App\Enums\RequestStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

class VehicleRequest extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'request_number',
        'requester_id',
        'department_id',
        'travel_date',
        'requested_start_time',
        'expected_end_time',
        'destination',
        'additional_destination',
        'purpose',
        'passenger_count',
        'contact_number',
        'special_requirements',
        'remarks',
        'status',
        'is_goodwill',
        'goodwill_reason',
        'is_external',
        'external_org',
        'expected_duration_days',
        'start_odometer',
    ];

    protected function casts(): array
    {
        return [
            'status' => RequestStatus::class,
            'travel_date' => 'date',
            'requested_start_time' => 'datetime',
            'expected_end_time' => 'datetime',
            'passenger_count' => 'integer',
            'is_goodwill' => 'boolean',
            'is_external' => 'boolean',
            'expected_duration_days' => 'integer',
            'start_odometer' => 'integer',
        ];
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requester_id');
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function approvals(): HasMany
    {
        return $this->hasMany(RequestApproval::class)->latest();
    }

    public function latestApproval(): HasOne
    {
        return $this->hasOne(RequestApproval::class)->latestOfMany();
    }

    public function trip(): HasOne
    {
        return $this->hasOne(Trip::class);
    }
}

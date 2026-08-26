<?php

namespace App\Models;

use App\Enums\ApprovalAction;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RequestApproval extends Model
{
    protected $fillable = [
        'vehicle_request_id',
        'approver_id',
        'action',
        'comment',
        'approved_at',
    ];

    protected function casts(): array
    {
        return [
            'action' => ApprovalAction::class,
            'approved_at' => 'datetime',
        ];
    }

    public function vehicleRequest(): BelongsTo
    {
        return $this->belongsTo(VehicleRequest::class);
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approver_id');
    }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class FuelLog extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'vehicle_id',
        'driver_id',
        'recorded_by',
        'purchase_date',
        'odometer',
        'previous_odometer',
        'litres',
        'price_per_litre',
        'total_cost',
        'fuel_type',
        'station',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'purchase_date' => 'datetime',
            'odometer' => 'integer',
            'previous_odometer' => 'integer',
            'litres' => 'decimal:2',
            'price_per_litre' => 'decimal:2',
            'total_cost' => 'decimal:2',
        ];
    }

    /** Distance covered since the previous fuel purchase, if known (km). */
    public function distanceSinceLast(): ?int
    {
        if ($this->previous_odometer === null) {
            return null;
        }

        return max(0, $this->odometer - $this->previous_odometer);
    }

    /** Fuel economy for the tank between purchases (km per litre). */
    public function kmPerLitre(): ?float
    {
        $distance = $this->distanceSinceLast();
        $litres = (float) $this->litres;
        if ($distance === null || $litres <= 0) {
            return null;
        }

        return round($distance / $litres, 3);
    }

    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    public function recordedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }
}

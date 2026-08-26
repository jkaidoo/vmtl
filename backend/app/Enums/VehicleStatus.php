<?php

namespace App\Enums;

enum VehicleStatus: string
{
    case AVAILABLE = 'available';
    case SCHEDULED = 'scheduled';
    case ON_TRIP = 'on_trip';
    case UNDER_MAINTENANCE = 'under_maintenance';
    case UNAVAILABLE = 'unavailable';
    case INACTIVE = 'inactive';

    public function label(): string
    {
        return match ($this) {
            self::AVAILABLE => 'Available',
            self::SCHEDULED => 'Scheduled',
            self::ON_TRIP => 'On Trip',
            self::UNDER_MAINTENANCE => 'Under Maintenance',
            self::UNAVAILABLE => 'Unavailable',
            self::INACTIVE => 'Inactive',
        };
    }

    public function color(): string
    {
        return match ($this) {
            self::AVAILABLE => 'green',
            self::SCHEDULED => 'purple',
            self::ON_TRIP => 'blue',
            self::UNDER_MAINTENANCE => 'amber',
            self::UNAVAILABLE => 'grey',
            self::INACTIVE => 'grey',
        };
    }

    /** Can this vehicle be assigned to a new trip? */
    public function isAssignable(): bool
    {
        return in_array($this, [self::AVAILABLE, self::SCHEDULED], true);
    }

    /** @return array<int, array{value:string,label:string,color:string}> */
    public static function options(): array
    {
        return array_map(
            fn (self $s) => ['value' => $s->value, 'label' => $s->label(), 'color' => $s->color()],
            self::cases()
        );
    }
}

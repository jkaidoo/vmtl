<?php

namespace App\Enums;

enum DriverStatus: string
{
    case AVAILABLE = 'available';
    case ON_TRIP = 'on_trip';
    case UNAVAILABLE = 'unavailable';
    case ON_LEAVE = 'on_leave';
    case INACTIVE = 'inactive';

    public function label(): string
    {
        return match ($this) {
            self::AVAILABLE => 'Available',
            self::ON_TRIP => 'On Trip',
            self::UNAVAILABLE => 'Unavailable',
            self::ON_LEAVE => 'On Leave',
            self::INACTIVE => 'Inactive',
        };
    }

    public function color(): string
    {
        return match ($this) {
            self::AVAILABLE => 'green',
            self::ON_TRIP => 'blue',
            self::UNAVAILABLE => 'grey',
            self::ON_LEAVE => 'amber',
            self::INACTIVE => 'grey',
        };
    }

    /** Can this driver be assigned to a new trip? */
    public function isAssignable(): bool
    {
        return $this === self::AVAILABLE;
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

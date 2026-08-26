<?php

namespace App\Enums;

enum TripStatus: string
{
    case SCHEDULED = 'scheduled';
    case IN_PROGRESS = 'in_progress';
    case COMPLETED = 'completed';
    case CANCELLED = 'cancelled';
    case NO_SHOW = 'no_show';

    public function label(): string
    {
        return match ($this) {
            self::SCHEDULED => 'Scheduled',
            self::IN_PROGRESS => 'In Progress',
            self::COMPLETED => 'Completed',
            self::CANCELLED => 'Cancelled',
            self::NO_SHOW => 'No Show',
        };
    }

    public function color(): string
    {
        return match ($this) {
            self::SCHEDULED => 'purple',
            self::IN_PROGRESS => 'green',
            self::COMPLETED => 'green',
            self::CANCELLED => 'grey',
            self::NO_SHOW => 'grey',
        };
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

<?php

namespace App\Enums;

enum RequestStatus: string
{
    case PENDING = 'pending';
    case CHANGES_REQUESTED = 'changes_requested';
    case APPROVED = 'approved';
    case REJECTED = 'rejected';
    case SCHEDULED = 'scheduled';
    case IN_PROGRESS = 'in_progress';
    case COMPLETED = 'completed';
    case CANCELLED = 'cancelled';
    case NO_SHOW = 'no_show';

    public function label(): string
    {
        return match ($this) {
            self::PENDING => 'Pending',
            self::CHANGES_REQUESTED => 'Changes Requested',
            self::APPROVED => 'Approved',
            self::REJECTED => 'Rejected',
            self::SCHEDULED => 'Scheduled',
            self::IN_PROGRESS => 'In Progress',
            self::COMPLETED => 'Completed',
            self::CANCELLED => 'Cancelled',
            self::NO_SHOW => 'No Show',
        };
    }

    /** Semantic colour token — resolved to concrete styles on the frontend (spec §30). */
    public function color(): string
    {
        return match ($this) {
            self::PENDING => 'amber',
            self::CHANGES_REQUESTED => 'purple',
            self::APPROVED => 'blue',
            self::REJECTED => 'red',
            self::SCHEDULED => 'purple',
            self::IN_PROGRESS => 'green',
            self::COMPLETED => 'green',
            self::CANCELLED => 'grey',
            self::NO_SHOW => 'grey',
        };
    }

    /** Statuses a staff member may cancel from. */
    public function isCancellable(): bool
    {
        return in_array($this, [self::PENDING, self::CHANGES_REQUESTED, self::APPROVED, self::SCHEDULED], true);
    }

    /** The requester may edit their request while in these states. */
    public function isEditableByRequester(): bool
    {
        return in_array($this, [self::PENDING, self::CHANGES_REQUESTED], true);
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

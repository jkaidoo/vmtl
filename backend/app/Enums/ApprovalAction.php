<?php

namespace App\Enums;

enum ApprovalAction: string
{
    case APPROVED = 'approved';
    case REJECTED = 'rejected';
    case CHANGES_REQUESTED = 'changes_requested';

    public function label(): string
    {
        return match ($this) {
            self::APPROVED => 'Approved',
            self::REJECTED => 'Rejected',
            self::CHANGES_REQUESTED => 'Changes Requested',
        };
    }
}

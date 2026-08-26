<?php

namespace App\Support;

use Illuminate\Database\Eloquent\Model;

class SequenceNumber
{
    /**
     * Build a zero-padded, prefixed sequence number that is unique for the model.
     * Uses the current max id + 1 and retries on collision (called inside a
     * transaction with row locks for the trip/request creation paths).
     */
    public static function next(string $modelClass, string $column, string $prefix, int $pad = 5): string
    {
        /** @var Model $modelClass */
        $max = $modelClass::withTrashed()->max('id') ?? 0;

        do {
            $max++;
            $candidate = sprintf('%s-%0'.$pad.'d', $prefix, $max);
        } while ($modelClass::withTrashed()->where($column, $candidate)->exists());

        return $candidate;
    }
}

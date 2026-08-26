<?php

namespace App\Exports;

use Maatwebsite\Excel\Concerns\FromArray;
use Maatwebsite\Excel\Concerns\ShouldAutoSize;
use Maatwebsite\Excel\Concerns\WithHeadings;
use Maatwebsite\Excel\Concerns\WithTitle;

class TripsExport implements FromArray, ShouldAutoSize, WithHeadings, WithTitle
{
    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @param  array<int, string>  $headings
     */
    public function __construct(
        private readonly array $rows,
        private readonly array $headings,
        private readonly string $title = 'Trips',
    ) {}

    /** @return array<int, array<int, mixed>> */
    public function array(): array
    {
        return array_map('array_values', $this->rows);
    }

    /** @return array<int, string> */
    public function headings(): array
    {
        return $this->headings;
    }

    public function title(): string
    {
        return substr($this->title, 0, 31);
    }
}

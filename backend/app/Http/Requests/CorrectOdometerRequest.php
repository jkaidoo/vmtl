<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CorrectOdometerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        return [
            'starting_odometer' => ['nullable', 'integer', 'min:0'],
            'ending_odometer' => ['nullable', 'integer', 'min:0'],
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
        ];
    }
}

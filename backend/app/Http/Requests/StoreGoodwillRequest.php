<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreGoodwillRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        return [
            'travel_date' => ['required', 'date'],
            'requested_start_time' => ['required', 'date'],
            'expected_end_time' => ['required', 'date', 'after:requested_start_time'],
            'destination' => ['required', 'string', 'max:255'],
            'passenger_count' => ['required', 'integer', 'min:1', 'max:100'],
            'contact_number' => ['nullable', 'string', 'max:50'],
            // The explanation is mandatory for a goodwill request.
            'goodwill_reason' => ['required', 'string', 'min:5', 'max:2000'],
        ];
    }

    /** @return array<string,string> */
    public function messages(): array
    {
        return [
            'goodwill_reason.required' => 'A description / explanation is required for a goodwill request.',
            'expected_end_time.after' => 'The end time must be after the start time.',
        ];
    }
}

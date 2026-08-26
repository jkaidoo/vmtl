<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateVehicleRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        return [
            'department_id' => ['nullable', 'exists:departments,id'],
            'travel_date' => ['sometimes', 'required', 'date'],
            'requested_start_time' => ['sometimes', 'required', 'date'],
            'expected_end_time' => ['sometimes', 'required', 'date', 'after:requested_start_time'],
            'destination' => ['sometimes', 'required', 'string', 'max:255'],
            'additional_destination' => ['nullable', 'string', 'max:255'],
            'purpose' => ['sometimes', 'required', 'string', 'max:2000'],
            'passenger_count' => ['sometimes', 'required', 'integer', 'min:1', 'max:100'],
            'contact_number' => ['nullable', 'string', 'max:50'],
            'special_requirements' => ['nullable', 'string', 'max:500'],
            'remarks' => ['nullable', 'string', 'max:2000'],
        ];
    }
}

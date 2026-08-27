<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreExternalTravelRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // capability check runs in the controller
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        return [
            'department_id' => ['nullable', 'exists:departments,id'],
            'org_unit_id' => ['nullable', 'exists:org_units,id'],
            // The arm / unit of the university requesting the vehicle.
            'external_org' => ['required', 'string', 'max:255'],
            'travel_date' => ['required', 'date'],
            'requested_start_time' => ['required', 'date'],
            'expected_end_time' => ['required', 'date', 'after:requested_start_time'],
            'expected_duration_days' => ['required', 'integer', 'min:1', 'max:365'],
            'destination' => ['required', 'string', 'max:255'],
            'passenger_count' => ['required', 'integer', 'min:1', 'max:100'],
            'contact_number' => ['nullable', 'string', 'max:50'],
            // Odometer reading before the trip began (at hand-over).
            'start_odometer' => ['required', 'integer', 'min:0'],
            // Reason for the external travel request.
            'purpose' => ['required', 'string', 'min:5', 'max:2000'],
            'remarks' => ['nullable', 'string', 'max:2000'],
        ];
    }

    /** @return array<string,string> */
    public function messages(): array
    {
        return [
            'external_org.required' => 'State which arm / unit of the university is requesting the vehicle.',
            'purpose.required' => 'A reason for the external travel is required.',
            'start_odometer.required' => 'Record the odometer reading before the trip began.',
            'expected_end_time.after' => 'The expected return must be after the departure time.',
        ];
    }
}

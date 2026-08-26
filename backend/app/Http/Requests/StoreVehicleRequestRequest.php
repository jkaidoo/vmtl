<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class StoreVehicleRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // policy check runs in the controller
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        $allowPast = $this->user()?->isAdministrator() ?? false;

        return [
            'department_id' => ['nullable', 'exists:departments,id'],
            'travel_date' => ['required', 'date', ...($allowPast ? [] : ['after_or_equal:today'])],
            'requested_start_time' => ['required', 'date', ...($allowPast ? [] : ['after_or_equal:now'])],
            'expected_end_time' => ['required', 'date', 'after:requested_start_time'],
            'destination' => ['required', 'string', 'max:255'],
            'additional_destination' => ['nullable', 'string', 'max:255'],
            'purpose' => ['required', 'string', 'max:2000'],
            'passenger_count' => ['required', 'integer', 'min:1', 'max:100'],
            'contact_number' => ['nullable', 'string', 'max:50'],
            'special_requirements' => ['nullable', 'string', 'max:500'],
            'remarks' => ['nullable', 'string', 'max:2000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $v) {
            // Passenger count should not exceed the largest vehicle in the fleet.
            $maxCapacity = (int) \App\Models\Vehicle::where('active', true)->max('capacity');
            if ($maxCapacity > 0 && (int) $this->input('passenger_count') > $maxCapacity) {
                $v->errors()->add('passenger_count', "Passenger count exceeds the largest available vehicle capacity ({$maxCapacity}).");
            }
        });
    }

    /** @return array<string,string> */
    public function messages(): array
    {
        return [
            'expected_end_time.after' => 'Requested departure must precede the expected return time.',
            'travel_date.after_or_equal' => 'Requests cannot be submitted for past dates.',
            'requested_start_time.after_or_equal' => 'Departure time cannot be in the past.',
        ];
    }
}

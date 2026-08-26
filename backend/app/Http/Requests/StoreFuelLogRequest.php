<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelLogRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // policy check runs in the controller
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        return [
            'vehicle_id' => ['required', 'exists:vehicles,id'],
            'driver_id' => ['nullable', 'exists:drivers,id'],
            'purchase_date' => ['required', 'date'],
            'odometer' => ['required', 'integer', 'min:0'],
            'litres' => ['required', 'numeric', 'min:0.01'],
            'price_per_litre' => ['required', 'numeric', 'min:0'],
            'fuel_type' => ['nullable', 'string', 'max:50'],
            'station' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }
}

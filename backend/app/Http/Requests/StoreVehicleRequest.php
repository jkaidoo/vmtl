<?php

namespace App\Http\Requests;

use App\Enums\VehicleStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

class StoreVehicleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        $vehicleId = $this->route('vehicle')?->id;

        return [
            'vehicle_number' => ['required', 'string', 'max:50', Rule::unique('vehicles', 'vehicle_number')->ignore($vehicleId)],
            'registration_number' => ['required', 'string', 'max:50', Rule::unique('vehicles', 'registration_number')->ignore($vehicleId)],
            'make' => ['nullable', 'string', 'max:100'],
            'model' => ['nullable', 'string', 'max:100'],
            'year' => ['nullable', 'integer', 'min:1950', 'max:'.(date('Y') + 1)],
            'vehicle_type' => ['nullable', 'string', 'max:100'],
            'colour' => ['nullable', 'string', 'max:50'],
            'capacity' => ['required', 'integer', 'min:1', 'max:100'],
            'current_odometer' => ['nullable', 'integer', 'min:0'],
            'org_unit_id' => ['nullable', 'exists:org_units,id'],
            'status' => ['sometimes', new Enum(VehicleStatus::class)],
            'acquisition_date' => ['nullable', 'date'],
            'insurance_expiry' => ['nullable', 'date'],
            'roadworthy_expiry' => ['nullable', 'date'],
            'service_interval_km' => ['nullable', 'integer', 'min:0'],
            'last_service_date' => ['nullable', 'date'],
            'last_service_odometer' => ['nullable', 'integer', 'min:0'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'active' => ['sometimes', 'boolean'],
        ];
    }
}

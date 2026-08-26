<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class RejectRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        // A rejection must always carry a reason (spec §8).
        return [
            'reason' => ['required', 'string', 'min:3', 'max:2000'],
        ];
    }
}

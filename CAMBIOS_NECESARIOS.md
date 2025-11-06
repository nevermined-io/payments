# Cambios Necesarios en TypeScript para Alinear con Python

## Resumen
Este documento lista los cambios necesarios en el proyecto TypeScript (`payments`) para que las llamadas al API coincidan con las del proyecto Python (`payments-py`), que está actualizado y funciona correctamente.

---

## 1. Cambios en `PlanPriceConfig` (src/common/types.ts)

### Campos que FALTAN en TypeScript (están en Python):
- `externalPriceAddress?: Address` - Dirección del precio externo
- `templateAddress?: Address` - Dirección de la plantilla
- `isCrypto: boolean` - Indica si es un pago en cripto (default: false)

### Campos que SOBRAN en TypeScript (no están en Python):
- `priceType: PlanPriceType` - Este campo NO se envía al API en Python. El backend deduce el tipo de precio basándose en `isCrypto` y otros campos.

### Acción requerida:
1. **Agregar** los campos faltantes a la interfaz `PlanPriceConfig`
2. **Eliminar o hacer opcional** el campo `priceType` (o mantenerlo solo para uso interno, pero no enviarlo al API)
3. **Actualizar** las funciones en `src/plans.ts` para que generen los objetos con los campos correctos

---

## 2. Cambios en `PlanCreditsConfig` (src/common/types.ts)

### Campos que FALTAN en TypeScript (están en Python):
- `isRedemptionAmountFixed: boolean` - Indica si la cantidad de redención es fija (default: false)

### Campos que SOBRAN en TypeScript (no están en Python):
- `creditsType: PlanCreditsType` - Este campo NO se envía al API en Python. El backend deduce el tipo basándose en `isRedemptionAmountFixed` y `durationSecs`.

### Diferencias de tipo:
- `amount`: En Python es `string`, en TypeScript es `bigint`. **Necesita convertirse a string al serializar**.
- `durationSecs`: En Python es `int`, en TypeScript es `bigint`. **Necesita convertirse a número al serializar**.
- `minAmount`: En Python es `int`, en TypeScript es `bigint`. **Necesita convertirse a número al serializar**.
- `maxAmount`: En Python es `int`, en TypeScript es `bigint`. **Necesita convertirse a número al serializar**.

### Acción requerida:
1. **Agregar** el campo `isRedemptionAmountFixed` a la interfaz `PlanCreditsConfig`
2. **Eliminar o hacer opcional** el campo `creditsType` (o mantenerlo solo para uso interno)
3. **Actualizar** las funciones en `src/plans.ts` para que generen los objetos con `isRedemptionAmountFixed` en lugar de `creditsType`
4. **Asegurar** que `amount` se serialice como string (no como bigint)
5. **Asegurar** que `durationSecs`, `minAmount`, `maxAmount` se serialicen como números (no como bigint)

---

## 3. Cambios en `plans.ts` - Funciones de construcción

### Funciones que necesitan actualización:

#### `getFiatPriceConfig`:
- Debe incluir: `externalPriceAddress: ZeroAddress`, `templateAddress: ZeroAddress`, `isCrypto: false`
- NO debe incluir: `priceType`

#### `getCryptoPriceConfig`:
- Debe incluir: `externalPriceAddress: ZeroAddress`, `templateAddress: ZeroAddress`, `isCrypto: true`
- NO debe incluir: `priceType`

#### `getFreePriceConfig`:
- Debe incluir: `externalPriceAddress: ZeroAddress`, `templateAddress: ZeroAddress`, `isCrypto: true`
- NO debe incluir: `priceType`

#### `getExpirableDurationConfig`:
- Debe usar: `isRedemptionAmountFixed: false`
- NO debe usar: `creditsType: PlanCreditsType.EXPIRABLE`
- `amount` debe ser string: `"1"` (no `1n`)
- `durationSecs`, `minAmount`, `maxAmount` deben ser números (no bigint)

#### `getFixedCreditsConfig`:
- Debe usar: `isRedemptionAmountFixed: true`
- NO debe usar: `creditsType: PlanCreditsType.FIXED`
- `amount` debe ser string (convertir bigint a string)
- `durationSecs`, `minAmount`, `maxAmount` deben ser números (no bigint)

#### `getDynamicCreditsConfig`:
- Debe usar: `isRedemptionAmountFixed: false`
- NO debe usar: `creditsType: PlanCreditsType.DYNAMIC`
- `amount` debe ser string (convertir bigint a string)
- `durationSecs`, `minAmount`, `maxAmount` deben ser números (no bigint)

#### `setRedemptionType`:
- Debe mantener `isRedemptionAmountFixed` del config original
- NO debe usar `creditsType`

#### `setProofRequired`:
- Debe mantener `isRedemptionAmountFixed` del config original
- NO debe usar `creditsType`

---

## 4. Cambios en `plans-api.ts` - Método `mintPlanExpirable`

### Problema actual:
TypeScript envía:
```typescript
{ planId, amount: creditsAmount, creditsReceiver, duration: creditsDuration }
```

### Debe enviar (como Python):
```typescript
{ planId, creditsAmount, creditsReceiver, creditsDuration }
```

### Acción requerida:
Cambiar el body en `mintPlanExpirable` para usar:
- `creditsAmount` en lugar de `amount`
- `creditsDuration` en lugar de `duration`

---

## 5. Cambios en `plans-api.ts` - Método `redeemCredits`

### Problema actual:
TypeScript tiene un typo en el body:
```typescript
creditsAmoamountuntToBurn: creditsAmountToRedeem  // ❌ TYPO
```

### Debe enviar (como Python):
```typescript
amount: creditsAmountToRedeem  // ✅ Correcto
```

### Acción requerida:
Corregir el typo en la línea 706 de `src/api/plans-api.ts`:
- Cambiar `creditsAmoamountuntToBurn` por `amount`

---

## 6. Cambios en serialización - `jsonReplacer` (src/common/helper.ts)

### Problema actual:
El `jsonReplacer` solo convierte `bigint` a `string`, pero necesita:
1. Convertir `bigint` a `string` para el campo `amount` en `PlanCreditsConfig`
2. Convertir `bigint` a `number` para `durationSecs`, `minAmount`, `maxAmount` en `PlanCreditsConfig`

### Acción requerida:
Actualizar `jsonReplacer` o crear una función de serialización específica que:
- Convierta `amount` (bigint) a string en `PlanCreditsConfig`
- Convierta `durationSecs`, `minAmount`, `maxAmount` (bigint) a number en `PlanCreditsConfig`
- Mantenga la conversión de bigint a string para otros casos

---

## 7. Resumen de cambios por archivo

### `src/common/types.ts`:
1. Agregar `externalPriceAddress`, `templateAddress`, `isCrypto` a `PlanPriceConfig`
2. Hacer opcional `priceType` en `PlanPriceConfig` (o eliminarlo si no se usa internamente)
3. Agregar `isRedemptionAmountFixed` a `PlanCreditsConfig`
4. Hacer opcional `creditsType` en `PlanCreditsConfig` (o eliminarlo si no se usa internamente)
5. Cambiar tipos: `amount` puede seguir siendo `bigint` pero debe serializarse como `string`

### `src/plans.ts`:
1. Actualizar todas las funciones de construcción de `PlanPriceConfig` para incluir los nuevos campos
2. Actualizar todas las funciones de construcción de `PlanCreditsConfig` para usar `isRedemptionAmountFixed` en lugar de `creditsType`
3. Convertir `amount` a string al crear los configs
4. Convertir `durationSecs`, `minAmount`, `maxAmount` a números al crear los configs

### `src/api/plans-api.ts`:
1. Corregir `mintPlanExpirable` para usar `creditsAmount` y `creditsDuration`
2. Corregir typo en `redeemCredits`: `creditsAmoamountuntToBurn` → `amount`

### `src/common/helper.ts`:
1. Actualizar `jsonReplacer` para manejar correctamente la serialización de `PlanCreditsConfig`

---

## Notas importantes

1. **Compatibilidad hacia atrás**: Si `priceType` y `creditsType` se usan internamente para validación o lógica, se pueden mantener como campos opcionales pero NO deben enviarse al API.

2. **Conversión de tipos**: Python usa `int` y `str`, mientras TypeScript usa `bigint`. La serialización debe convertir correctamente:
   - `bigint` → `string` para `amount`
   - `bigint` → `number` para `durationSecs`, `minAmount`, `maxAmount`

3. **Naming conventions**: Python usa snake_case que se convierte a camelCase al enviar al API. TypeScript ya usa camelCase, así que los nombres de campos deben coincidir.

4. **Validación**: Las validaciones que usan `creditsType` en TypeScript deben actualizarse para usar `isRedemptionAmountFixed` y `durationSecs` en su lugar.


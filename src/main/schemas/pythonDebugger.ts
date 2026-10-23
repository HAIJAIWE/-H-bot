// src/main/schemas/pythonDebugger.ts
import { z } from 'zod'

/** debugger:start 入参 schema */
export const startSchema = z.object({
  projectPath: z.string().min(1),
  options: z
    .object({
      port: z.number().int().positive().optional(),
      stopOnEntry: z.boolean().optional(),
      breakOnException: z.boolean().optional(),
      env: z.record(z.string(), z.string()).optional(),
      extraArgs: z.array(z.string()).optional()
    })
    .optional()
})

/** debugger:stop / debugger:getState 等只需 projectPath 的 schema */
export const projectPathSchema = z.object({ projectPath: z.string().min(1) })

/** debugger:setBreakpoints 入参 schema */
export const setBreakpointsSchema = z.object({
  projectPath: z.string().min(1),
  filePath: z.string().min(1),
  breakpoints: z.array(
    z.object({
      line: z.number().int().positive(),
      condition: z.string().optional(),
      hitCondition: z.string().optional(),
      logMessage: z.string().optional(),
      enabled: z.boolean()
    })
  )
})

/** debugger:setFunctionBreakpoints 入参 schema */
export const setFunctionBreakpointsSchema = z.object({
  projectPath: z.string().min(1),
  breakpoints: z.array(
    z.object({
      name: z.string().min(1),
      condition: z.string().optional(),
      hitCondition: z.string().optional(),
      enabled: z.boolean()
    })
  )
})

/** debugger:getVariables 入参 schema */
export const getVariablesSchema = z.object({
  projectPath: z.string().min(1),
  variablesReference: z.number().int().nonnegative()
})

/** debugger:evaluate 入参 schema */
export const evaluateSchema = z.object({
  projectPath: z.string().min(1),
  expression: z.string().min(1),
  frameId: z.number().int().positive().optional(),
  context: z.enum(['watch', 'repl', 'hover']).optional()
})

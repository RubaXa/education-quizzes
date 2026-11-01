#!/usr/bin/env node
/** @see ../docs/decisions/local-connect-diagnostics-2026-11-01.md */
/** @see ../docs/shared/server-runtime.md#авторизация-и-совместимость */
import {spawnSync} from 'node:child_process'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {existsSync} from 'node:fs'
const entry = fileURLToPath(new URL('../packages/education-connect/bin/education-connect.mjs',import.meta.url))
const usage='Использование: npm run connect:diagnose -- --invite <код>\nПроверка ввода без сети: npm run connect:diagnose -- --input-check --show-password-prefix\nПроверка среды без входа: npm run connect:diagnose -- --check\n'
export function main(args=process.argv.slice(2), {run=spawnSync,write=message=>process.stdout.write(message),env=process.env,cwd=process.cwd()}={}) {
 if(args.includes('--help')){write(usage);return 0}
 write(`Локальный Education Connect · Node ${process.version} · ${process.platform}\nРабочий каталог: ${cwd}\nПакет: ${entry}\n`)
 write(`HTTP_PROXY/HTTPS_PROXY: ${env.HTTP_PROXY||env.HTTPS_PROXY||env.http_proxy||env.https_proxy?'задан':'нет'}; дополнительный CA: ${env.NODE_EXTRA_CA_CERTS?'задан':'нет'}\n`)
 if(args.includes('--show-password-prefix'))write('По вашему выбору начало пароля будет показано в этом терминале. Не присылайте эту строку в чат.\n')
 write('Диагностика выводится только в терминал. Логин виден; ввод пароля и SMS скрыт.\n')
 if(!existsSync(entry)){write('Ошибка: локальный пакет не найден.\n');return 1}
 if(args.length===1&&args[0]==='--check'){write('Локальный пакет найден. Вход, регистрация устройства и передача доступа не запускались.\n');return 0}
 const flags=args.filter(arg=>arg!=='--show-password-prefix')
 const validInput=flags.length===1&&flags[0]==='--input-check'
 const validInvite=flags.length===2&&flags[0]==='--invite'&&/^[A-Za-z0-9_-]{43}$/.test(flags[1])
 if(args.filter(arg=>arg==='--show-password-prefix').length>1||(!validInput&&!validInvite)){write(usage);return 2}
 const child=run(process.execPath,[entry,'--diagnose',...args],{stdio:'inherit',env,shell:false})
 if(child.error){write('Не удалось запустить локальный пакет.\n');return 1}
 return child.status??1
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=main()

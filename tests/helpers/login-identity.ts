import { control } from "../../src/lib/control";
import { loginSource } from "../../src/lib/login-source";
import { loginIdentifierKey } from "../../src/lib/login-identity";
try {
  loginIdentifierKey();
  // Only a synthetic source identifier crosses the process boundary, never the key.
  process.stdout.write(loginSource(new Headers({ "x-real-ip": "192.0.2.1" })));
} finally {
  control().close();
}

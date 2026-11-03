import com.jayway.jsonpath.InvalidJsonException;
import com.jayway.jsonpath.InvalidPathException;
import com.jayway.jsonpath.JsonPath;
import com.jayway.jsonpath.PathNotFoundException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Collectors;
import net.minidev.json.JSONArray;
import net.minidev.json.JSONObject;
import net.minidev.json.parser.JSONParser;

/**
 * Evaluates the JSONPATH expressions of this package the way openHAB's JSONPATH transformation does.
 * transform() is a line-by-line copy of JSonPathTransformationService.transform / flattenList of
 * openhab-addons (bundles/org.openhab.transform.jsonpath, uses com.jayway.jsonpath:json-path 2.10.0),
 * with TransformationException replaced by an "ERROR: ..." result.
 *
 * usage: java -cp "lib/*:out" OhJsonPath cases.json [fixtureDir]   (default fixture dir ../fixtures)
 * exit code 0 if every case gives the expected text, 1 otherwise.
 */
public class OhJsonPath {

    static String transform(String jsonPathExpression, String source) {
        if (source.isBlank()) {
            return null;
        }
        try {
            Object transformationResult = JsonPath.read(source, jsonPathExpression);
            if (transformationResult == null) {
                return null;
            } else if (transformationResult instanceof List<?> list) {
                return flattenList(list);
            } else {
                return transformationResult.toString();
            }
        } catch (PathNotFoundException e) {
            return "ERROR: Invalid path '" + jsonPathExpression + "'";
        } catch (InvalidPathException | InvalidJsonException e) {
            return "ERROR: An error occurred while transforming JSON expression: " + e.getMessage();
        } catch (RuntimeException e) {
            // not caught by the openHAB service either: the exception reaches the caller (and is logged there)
            return "EXCEPTION: " + e.getClass().getSimpleName() + ": " + e.getMessage();
        }
    }

    static String flattenList(List<?> list) {
        if (list.size() == 1) {
            return list.get(0).toString();
        }
        if (list.size() > 1) {
            if (list.get(0) instanceof Number || list.get(0) instanceof Boolean) {
                return list.stream().map(String::valueOf).collect(Collectors.joining(", ", "[", "]"));
            } else if (list.get(0) instanceof String) {
                return list.stream().map(n -> "\"" + n + "\"").collect(Collectors.joining(", ", "[", "]"));
            }
            return "WARN: only Boolean, Number and String lists are supported";
        }
        return "NULL";
    }

    public static void main(String[] args) throws Exception {
        Path cases = Path.of(args[0]);
        JSONArray all = (JSONArray) new JSONParser(JSONParser.MODE_PERMISSIVE).parse(Files.readString(cases));
        int failed = 0;
        for (Object o : all) {
            JSONObject c = (JSONObject) o;
            String dir = args.length > 1 ? args[1] : "../fixtures";
            String source = Files.readString(Path.of(dir, (String) c.get("file")));
            String got = transform((String) c.get("expr"), source);
            String want = (String) c.get("expect");
            boolean ok = want.equals(got);
            if (c.get("regex") != null) {
                want = "matches " + c.get("regex");
                ok = got != null && got.matches((String) c.get("regex"));
            }
            // expect may also be a prefix match for long lists
            if (!ok && c.get("startsWith") != null && got != null) {
                ok = got.startsWith((String) c.get("startsWith"));
            }
            System.out.println((ok ? "ok    " : "FAIL  ") + c.get("name") + "  " + c.get("expr") + "  ->  " + (got == null ? "null" : (got.length() > 70 ? got.substring(0, 70) + "..." : got)));
            if (!ok) {
                failed++;
                System.out.println("      expected: " + want);
            }
        }
        System.out.println(failed == 0 ? "all " + all.size() + " cases ok" : failed + " of " + all.size() + " cases FAILED");
        System.exit(failed == 0 ? 0 : 1);
    }
}
